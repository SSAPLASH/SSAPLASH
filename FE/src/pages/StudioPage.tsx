// 라이브러리 (CHART-003, Jira 189 · CHART-002 MIDI 업로드 · Figma 207:2110 외). 헤더 [곡 올리기] → 업로드 창(음원/MIDI 탭), 아래 목록(카드·목록 보기)과 안내 패널.
// 곡이 없는 첫 방문에는 창 없이 본문에 같은 탭 양식을 둔다(설계 CHART-002 4-1).
// 상태·폴링은 store/chartJobStore, MIDI는 store/midiUploadStore, 목록은 store/songStore. 이 페이지는 세 store를 접착한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { listSheets, deleteSheet, updateSheetTitle } from '@/api/sheets';
import { SHEET_ARCHIVE_ENABLED, SHEET_RELINK_ENABLED, SHEET_SONG_LINK_ENABLED, SONG_EDIT_ENABLED } from '@/app/features';
import { SheetDeleteDialog } from '@/components/sheet/SheetDeleteDialog';
import { SheetTitleDialog } from '@/components/sheet/SheetTitleDialog';
import { useShell } from '@/components/shell/useShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { HowtoPanel } from '@/components/studio/HowtoPanel';
import { MySongList, type StudioView } from '@/components/studio/MySongList';
import type { SheetMenuKind } from '@/components/studio/SheetMenu';
import { SheetUploadForm } from '@/components/studio/SheetUploadForm';
import { SongCoverDialog } from '@/components/studio/SongCoverDialog';
import { SongDeleteDialog } from '@/components/studio/SongDeleteDialog';
import { SongMetaDialog } from '@/components/studio/SongMetaDialog';
import { StudioToast } from '@/components/studio/StudioToast';
import { useAccompanimentPolling } from '@/components/studio/useAccompanimentPolling';
import type { SongEditKind, SongSheetKind } from '@/components/studio/SongMenu';
import { PlusIcon } from '@/components/studio/StudioIcons';
import { UploadDialog, type UploadSection } from '@/components/studio/UploadDialog';
import { UploadPanel, type UploadTab } from '@/components/studio/UploadPanel';
import type { MidiDraft } from '@/domain/midiUpload';
import type { SheetSummary } from '@/domain/sheetMusic';
import { summarizeMineSongs, type SongSummary } from '@/domain/songCatalog';
import { coverRefreshDue, type CoverChange } from '@/domain/songCover';
import type { SongMetaPatch } from '@/domain/songEdit';
import { useChartJob } from '@/store/chartJobStore';
import { useMidiUpload } from '@/store/midiUploadStore';
import { useSheetLink } from '@/store/sheetLinkStore';
import { useSongEdit } from '@/store/songEditStore';
import { useSongs } from '@/store/songStore';

const JUST_DONE_MS = 2000;
/** 삭제 완료 알림을 보이는 시간(U8) */
const TOAST_MS = 3000;

/** 고른 보기(카드·목록)를 브라우저에 기억한다. 접근이 막힌 환경에서는 기본(카드)으로 동작한다 */
const VIEW_KEY = 'airdrum.studio.view';

function loadView(): StudioView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'card';
  } catch {
    return 'card';
  }
}

function saveView(view: StudioView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // 저장하지 못해도 화면은 그대로 쓴다
  }
}

/** 올리기 창의 마지막 섹션을 브라우저에 기억한다 */
const SECTION_KEY = 'airdrum.studio.uploadSection';

function loadSection(): UploadSection {
  try {
    return localStorage.getItem(SECTION_KEY) === 'SHEET' ? 'SHEET' : 'SONG';
  } catch {
    return 'SONG';
  }
}

function saveSection(section: UploadSection): void {
  try {
    localStorage.setItem(SECTION_KEY, section);
  } catch {
    // 저장하지 못해도 창은 그대로 쓴다
  }
}

interface SheetEditing {
  kind: SheetMenuKind;
  sheet: SheetSummary;
}

interface Editing {
  kind: SongEditKind;
  song: SongSummary;
}

export function StudioPage() {
  useShell({ title: '라이브러리' });
  const navigate = useNavigate();
  const location = useLocation();
  const { active, progress, phase, error, doneSource, upload, resume, retry, clear, stopPolling } = useChartJob();
  const load = useSongs((s) => s.load);
  const scope = useSongs((s) => s.scope);
  const rawItems = useSongs((s) => s.items);
  const rawStatus = useSongs((s) => s.status);
  const listError = useSongs((s) => s.error);
  const midiPhase = useMidiUpload((s) => s.phase);
  const midiError = useMidiUpload((s) => s.error);
  const midiUpload = useMidiUpload((s) => s.upload);
  const midiReset = useMidiUpload((s) => s.reset);

  // 악보만 항목의 [곡 올리기]: 대상 악보와 연결 실패 대상(설계 CHART-001 D16·D17)
  const linkTarget = useSheetLink((s) => s.target);
  const linkPending = useSheetLink((s) => s.pending);
  const linkPhase = useSheetLink((s) => s.phase);

  const editPhase = useSongEdit((s) => s.phase);
  const editError = useSongEdit((s) => s.error);
  const editReset = useSongEdit((s) => s.reset);

  const [view, setView] = useState<StudioView>(loadView);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [prefill, setPrefill] =useState<{ title: string; artist: string } | null>(null);
  // 다시 올리기를 누를 때마다 올려 업로드 패널을 새로 마운트한다(프리필 반영)
  const [prefillSeq, setPrefillSeq] = useState(0);
  const [justDoneId, setJustDoneId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // 악보 보관(설계 CHART-001 악보 보관): 악보 목록은 곡 목록과 따로 읽고, 둘 중 하나만 실패해도 나머지는 보인다
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [sheetsStatus, setSheetsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [section, setSection] = useState<UploadSection>(loadSection);
  // openUpload(useCallback)에서 렌더 시점의 첫 방문 여부를 읽기 위한 ref
  const firstVisitRef = useRef(false);
  // 곡 ⋯ [악보 올리기]로 열었을 때 붙일 곡(헤더에서 열면 null)
  const [sheetTarget, setSheetTarget] = useState<SongSummary | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const sheetBusyRef = useRef(false);
  const [sheetEditing, setSheetEditing] = useState<SheetEditing | null>(null);
  // 창을 다시 열면 마지막 탭을 유지한다
  const [tab, setTab] = useState<UploadTab>('AUDIO');
  const prevPhase = useRef(phase);
  const justDoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 커버 오류로 목록을 마지막으로 다시 읽은 시각(U10)
  const coverRefreshAt = useRef<number | null>(null);

  // 들어오면 진행 중 작업을 복원해 폴링하고 목록을 읽는다. 나가면 타이머만 멈춘다(기록은 남는다)
  useEffect(() => {
    resume();
    void load('MINE');
    return () => {
      stopPolling();
      if (justDoneTimer.current !== null) clearTimeout(justDoneTimer.current);
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    };
  }, [resume, stopPolling, load]);

  const loadSheets = useCallback(async () => {
    if (!SHEET_ARCHIVE_ENABLED) return;
    try {
      const page = await listSheets();
      setSheets(page.items);
      setSheetsStatus('ready');
    } catch {
      setSheetsStatus('error');
    }
  }, []);

  // 들어오면 악보 목록을 읽는다(곡 목록과 따로 — 한쪽 실패가 다른 쪽을 가리지 않는다)
  useEffect(() => {
    if (!SHEET_ARCHIVE_ENABLED) return;
    let off = false;
    listSheets()
      .then((page) => {
        if (off) return;
        setSheets(page.items);
        setSheetsStatus('ready');
      })
      .catch(() => {
        if (!off) setSheetsStatus('error');
      });
    return () => {
      off = true;
    };
  }, []);

  // 새 곡 행을 잠깐 강조한다
  const flashRow = useCallback((songId: number) => {
    setJustDoneId(songId);
    if (justDoneTimer.current !== null) clearTimeout(justDoneTimer.current);
    justDoneTimer.current = setTimeout(() => setJustDoneId(null), JUST_DONE_MS);
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  // 곡이 등록된 직후 target 악보를 그 곡에 연결하고(PATCH 1회) 곡·악보 목록을 다시 읽는다. 실패해도 곡은 남으므로 목록은 읽는다(D16·D17)
  const finishLink = useCallback(
    async (run: () => Promise<void>) => {
      await run();
      await Promise.all([load('MINE'), loadSheets()]);
      if (useSheetLink.getState().phase === 'done') showToast('곡을 올리고 악보를 연결했어요');
    },
    [load, loadSheets, showToast],
  );
  const linkToSong = useCallback((songId: number) => finishLink(() => useSheetLink.getState().link(songId)), [finishLink]);
  const retryLink = useCallback(() => void finishLink(() => useSheetLink.getState().retry()), [finishLink]);

  // 뷰어에서 악보를 지우고 돌아오면(라우터 state) 토스트를 보이고 state를 비운다(새로고침해도 다시 뜨지 않게)
  const sheetDeletedFlag = (location.state as { sheetDeleted?: boolean } | null)?.sheetDeleted === true;
  useEffect(() => {
    if (!SHEET_ARCHIVE_ENABLED || !sheetDeletedFlag) return;
    queueMicrotask(() => showToast('악보를 지웠어요'));
    navigate(location.pathname, { replace: true, state: null });
  }, [sheetDeletedFlag, navigate, location.pathname, showToast]);

  // 서명 URL이 만료돼 커버를 못 불러오면 목록을 다시 읽어 새 URL을 받는다. 카드 여럿이 한꺼번에 실패해도 1분에 한 번만
  const onCoverError = useCallback(() => {
    const now = Date.now();
    if (!coverRefreshDue(coverRefreshAt.current, now)) return;
    coverRefreshAt.current = now;
    void load('MINE');
  }, [load]);

  // 접착 규칙: 202(업로드 → 폴링)·완료·실패에 따라 창 닫기·목록 재조회·이동·강조·clear
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = phase;

    if (phase === 'polling' && prev === 'uploading' && active) {
      // 효과 안 동기 setState를 피해 한 틱 미룬다
      queueMicrotask(() => setDialogOpen(false));
      void load('MINE');
      // 음원은 202 응답의 songId로 바로 연결한다(채보 생성이 끝나길 기다리지 않는다). 효과 안 동기 setState를 피해 한 틱 미룬다.
      // jobId가 없으면 이번 업로드가 아니라 AUDIO_BUSY로 복구한 다른 생성 중 곡이다 — 그 곡에 붙이지 않고 대상 지정만 푼다
      const songId = active.songId;
      const accepted = active.jobId !== null;
      queueMicrotask(() => {
        if (!useSheetLink.getState().target) return;
        if (accepted) void linkToSong(songId);
        else useSheetLink.getState().cancel();
      });
      return;
    }
    if (phase === 'done' && active) {
      const songId = active.songId;
      if (doneSource === 'live') {
        clear();
        navigate(`/sheet?scope=MINE&song=${songId}`);
      } else if (doneSource === 'restored') {
        queueMicrotask(() => flashRow(songId));
        void load('MINE');
        clear();
      }
      return;
    }
    if (phase === 'failed' && error?.code === 'JOB_FAILED') {
      void load('MINE');
      clear();
    }
  }, [phase, doneSource, active, error, load, clear, navigate, flashRow, linkToSong]);

  const onReupload = useCallback((song: SongSummary) => {
    useSheetLink.getState().cancel();
    setPrefill({ title: song.title, artist: song.artist });
    setPrefillSeq((n) => n + 1);
    setTab('AUDIO');
    setDialogOpen(true);
  }, []);

  const changeView = useCallback((v: StudioView) => {
    setView(v);
    saveView(v);
  }, []);

  const openEdit = useCallback(
    (kind: SongEditKind, song: SongSummary) => {
      editReset();
      setEditing({ kind, song });
    },
    [editReset],
  );

  // 저장 중에는 닫지 않는다
  const closeEdit = useCallback(() => {
    if (useSongEdit.getState().phase === 'saving') return;
    editReset();
    setEditing(null);
  }, [editReset]);

  // 편집 1회: 성공하면 창 닫기 → 목록 재조회 → (삭제 아니면) 카드 강조. 이미 없는 곡·결과를 모르는 실패는 목록만 다시 읽는다
  const runEdit = useCallback(
    async (song: SongSummary, action: () => Promise<void>, removed: boolean) => {
      await action();
      const { phase: p, error: err } = useSongEdit.getState();
      if (p === 'done') {
        setEditing(null);
        editReset();
        if (removed && useChartJob.getState().active?.songId === song.id) clear();
        // BE는 곡을 지우면 연결된 악보도 같이 지운다. 악보 목록도 다시 읽어야 곡 없는 악보로 남지 않는다
        await Promise.all([load('MINE'), removed && song.sheetId != null ? loadSheets() : undefined]);
        if (removed) showToast(`「${song.title}」을 삭제했습니다.`);
        else flashRow(song.id);
      } else if (p === 'failed' && (err?.uncertain || err?.code === 'SONG_NOT_FOUND')) {
        void load('MINE');
      }
    },
    [editReset, clear, load, loadSheets, flashRow, showToast],
  );

  const saveMeta = (song: SongSummary, patch: SongMetaPatch) =>
    void runEdit(song, () => useSongEdit.getState().saveMeta(song.id, patch), false);
  const saveCover = (song: SongSummary, change: CoverChange) =>
    void runEdit(song, () => useSongEdit.getState().saveCover(song.id, change), false);
  const removeSong = (song: SongSummary) => void runEdit(song, () => useSongEdit.getState().remove(song.id), true);

  const editBusy = editPhase === 'saving';
  const editErrorText = editPhase === 'failed' ? (editError?.text ?? null) : null;

  const locked = phase === 'uploading' || midiPhase === 'uploading' || sheetBusy;

  // 업로드 중에는 닫지 않는다. 닫을 때 MIDI 실패 문구는 비워 다음에 열 때 남지 않게 한다
  const closeDialog = useCallback(() => {
    if (useChartJob.getState().phase === 'uploading' || useMidiUpload.getState().phase === 'uploading' || sheetBusyRef.current) return;
    if (useMidiUpload.getState().phase === 'failed') midiReset();
    // 악보에 곡 올리기 중이었다면 대상 지정을 푼다(창을 닫으면 연결하지 않는다)
    useSheetLink.getState().cancel();
    setDialogOpen(false);
  }, [midiReset]);

  // 헤더 [올리기]: 곡 없이 마지막에 쓴 섹션으로 연다.
  // 첫 방문은 본문에 음원·MIDI 패널이 이미 있으므로 [악보] 섹션으로만 연다(같은 패널이 두 번 그려지지 않게)
  const openUpload = useCallback(() => {
    useSheetLink.getState().cancel();
    setSheetTarget(null);
    if (firstVisitRef.current) setSection('SHEET');
    setDialogOpen(true);
  }, []);

  const changeSection = useCallback((next: UploadSection) => {
    setSection(next);
    saveSection(next);
  }, []);

  const onSheetBusy = useCallback((busy: boolean) => {
    sheetBusyRef.current = busy;
    setSheetBusy(busy);
  }, []);

  // 악보 올리기 성공: 창을 닫고 곡·악보 목록을 다시 읽고 알린다(곡에 붙였으면 그 곡 ⋯ 메뉴가 [악보 보기]로 바뀐다)
  const onSheetUploaded = useCallback(() => {
    setDialogOpen(false);
    setSheetTarget(null);
    void load('MINE');
    void loadSheets();
    showToast('악보를 올렸어요');
  }, [load, loadSheets, showToast]);

  // 곡 ⋯ 메뉴의 악보 항목(악보-곡 연결 스위치 켜짐)
  const onSongSheet = useCallback(
    (kind: SongSheetKind, song: SongSummary) => {
      if (kind === 'sheetView') {
        if (song.sheetId != null) navigate(`/studio/sheets/${song.sheetId}`);
        return;
      }
      useSheetLink.getState().cancel();
      setSheetTarget(song);
      setSection('SHEET');
      setDialogOpen(true);
    },
    [navigate],
  );

  // 악보만 항목의 [곡 올리기]: 대상 악보를 정하고 업로드 창을 [음원·MIDI]로 연다. 다시 올리기 안내는 끈다
  const onUploadSong = useCallback((sheet: SheetSummary) => {
    useSheetLink.getState().begin(sheet);
    setPrefill(null);
    setSheetTarget(null);
    setDialogOpen(true);
  }, []);

  const onSheetMenu = useCallback((kind: SheetMenuKind, sheet: SheetSummary) => setSheetEditing({ kind, sheet }), []);

  // MIDI는 작업(job) 없이 동기 처리다: 201이면 창을 닫고 목록을 다시 읽어 새 곡 행을 강조한다(이동 없음).
  // 결과를 모르는 실패(네트워크·5xx)는 서버에 저장됐을 수 있어 목록도 다시 읽는다
  const onMidiSubmit = useCallback(
    async (draft: MidiDraft) => {
      await midiUpload(draft);
      const { phase: p, song, error: err } = useMidiUpload.getState();
      if (p === 'done' && song) {
        setDialogOpen(false);
        midiReset();
        // MIDI·MusicXML은 201 응답의 곡 id로 바로 연결한다(finishLink가 목록도 다시 읽는다)
        if (useSheetLink.getState().target) await linkToSong(song.id);
        else await load('MINE');
        flashRow(song.id);
      } else if (p === 'failed' && err?.uncertain) {
        void load('MINE');
      }
    },
    [midiUpload, midiReset, load, flashRow, linkToSong],
  );

  // songStore가 곡 선택 창 등에서 다른 범위로 채워져 있으면 아직 안 읽은 것으로 본다
  const isMine = scope === 'MINE';
  const items = isMine ? rawItems : [];
  const status = isMine ? rawStatus : 'loading';
  // 채보는 READY인데 반주가 생성 중인 곡만 짧게 다시 읽어 배지를 갱신한다(설계 CHART-002 반주 상태 4-2)
  useAccompanimentPolling(items, status === 'ready');

  // store가 이미 사용자용 문장으로 만들어 둔다
  const errorText = error?.detail ?? null;
  const jobLookupError = phase === 'failed' && active !== null && (error?.code === 'AUDIO_NOT_FOUND' || error?.code === 'JOB_AUTH');
  const displayedActive = jobLookupError ? null : active;
  // 악보만 올려 둔 사람은 첫 방문이 아니다. 악보 목록을 읽는 동안에는 판단을 미룬다(빈 화면으로 깜빡이지 않게 목록만 비운다)
  const sheetsEmpty = !SHEET_ARCHIVE_ENABLED || sheetsStatus === 'error' || (sheetsStatus === 'ready' && sheets.length === 0);
  const firstVisit = status === 'ready' && items.length === 0 && displayedActive === null && sheetsEmpty;
  useEffect(() => {
    firstVisitRef.current = firstVisit;
  }, [firstVisit]);
  const audioBusyTitle = phase === 'polling' && active ? active.title : null;

  const panel = (emphasis: boolean) => (
    <UploadPanel
      key={`${prefillSeq}-${linkTarget?.id ?? 'none'}`}
      initialTitle={linkTarget?.title}
      tab={tab}
      onTab={setTab}
      locked={locked}
      emphasis={emphasis}
      onCancel={emphasis ? undefined : closeDialog}
      audioBusyTitle={audioBusyTitle}
      audio={{
        busy: phase === 'uploading',
        error: phase === 'failed' ? errorText : null,
        retryable: error?.retryable === true,
        onSubmit: (draft) => {
          setPrefill(null);
          void upload(draft);
        },
        onRetry: () => void retry(),
        prefill,
        onCancelPrefill: () => setPrefill(null),
      }}
      midi={{
        busy: midiPhase === 'uploading',
        error: midiPhase === 'failed' ? (midiError?.text ?? null) : null,
        onSubmit: (draft) => void onMidiSubmit(draft),
      }}
    />
  );

  // 요약: 곡 n개 · 생성 중 n. 활성 작업이 목록에 아직 없으면 임시 행(MySongList)과 같이 센다
  const mine = summarizeMineSongs(items);
  const tempRow = displayedActive !== null && !items.some((s) => s.id === displayedActive.songId);
  const total = mine.total + (tempRow ? 1 : 0);
  const processing = mine.processing + (tempRow ? 1 : 0);
  let summary: string;
  if (status === 'idle' || status === 'loading') summary = '불러오는 중…';
  else if (status === 'error') summary = '목록을 불러오지 못했어요';
  else if (firstVisit) summary = '아직 올린 곡이 없어요. 음원이나 MIDI를 올리면 드럼 악보를 만들어 드려요.';
  else {
    summary = processing > 0 ? `곡 ${total}개 · 생성 중 ${processing}` : `곡 ${total}개`;
    if (SHEET_ARCHIVE_ENABLED && sheets.length > 0) summary += ` · 악보 ${sheets.length}개`;
  }

  // 안내 패널은 카드 보기에서만 오른쪽에 둔다(목록 보기·로딩·오류는 본문 전체 폭, Figma 225:4551·225:5042·225:5368)
  const split = status === 'ready' && view === 'card';

  return (
    <main className={`main studio-page${split || firstVisit ? ' roomy' : ''}`}>
      <header className="studio-head">
        <div className="studio-head-title">
          <h2 className="t-title-24">라이브러리</h2>
          <p className="studio-summary">{summary}</p>
        </div>
        {/* 악보 기능이 켜져 있으면 첫 방문에도 [올리기]를 둔다: 악보만 올리는 사람이 [악보] 섹션에 닿을 길이다 */}
        {(!firstVisit || SHEET_ARCHIVE_ENABLED) && (
          <Button variant="primary" size="md" className="studio-upload-btn" leadingIcon={<PlusIcon />} onClick={openUpload}>
            {SHEET_ARCHIVE_ENABLED ? '올리기' : '곡 올리기'}
          </Button>
        )}
      </header>
      {jobLookupError && <p className="notice error" role="alert">{errorText}</p>}
      {SHEET_RELINK_ENABLED && linkPending !== null && (
        <p className="notice error" role="alert">
          곡은 올렸지만 악보를 연결하지 못했어요
          <Button variant="text" size="sm" disabled={linkPhase === 'linking'} onClick={retryLink}>
            다시 연결
          </Button>
        </p>
      )}
      {firstVisit ? (
        <>
          <Card padding="lg" className="studio-first-card">
            {panel(true)}
          </Card>
          <HowtoPanel variant="steps" />
        </>
      ) : (
        <div className={`studio-body${split ? ' split' : ''}`}>
          <div className="studio-main-col">
            <div className="studio-toolbar">
              <p className="studio-sortnote">처리 중 → 실패 → 완료 · 같은 상태는 최신순</p>
              <Segmented<StudioView>
                label="보기 방식"
                value={view}
                onChange={changeView}
                options={[
                  { value: 'card', label: '카드' },
                  { value: 'list', label: '목록' },
                ]}
              />
            </div>
            <MySongList
              status={status}
              items={items}
              error={listError}
              onRetry={() => void load('MINE')}
              active={displayedActive}
              progress={progress}
              justDoneId={justDoneId}
              onReupload={onReupload}
              view={view}
              onEdit={SONG_EDIT_ENABLED ? openEdit : undefined}
              onCoverError={onCoverError}
              sheets={SHEET_ARCHIVE_ENABLED ? sheets : undefined}
              sheetsFailed={SHEET_ARCHIVE_ENABLED && sheetsStatus === 'error'}
              onSheetsRetry={() => void loadSheets()}
              linkEnabled={SHEET_SONG_LINK_ENABLED}
              onSheetMenu={onSheetMenu}
              onSheetCoverError={() => void loadSheets()}
              onSongSheet={SHEET_ARCHIVE_ENABLED && SHEET_SONG_LINK_ENABLED && SONG_EDIT_ENABLED ? onSongSheet : undefined}
              onUploadSong={SHEET_ARCHIVE_ENABLED && SHEET_RELINK_ENABLED ? onUploadSong : undefined}
            />
          </div>
          {split && <HowtoPanel variant="panel" />}
        </div>
      )}
      {editing?.kind === 'cover' && (
        <SongCoverDialog
          key={editing.song.id}
          song={editing.song}
          busy={editBusy}
          error={editErrorText}
          onSave={(change) => saveCover(editing.song, change)}
          onClose={closeEdit}
        />
      )}
      {editing?.kind === 'meta' && (
        <SongMetaDialog
          key={editing.song.id}
          song={editing.song}
          busy={editBusy}
          error={editErrorText}
          onSave={(patch) => saveMeta(editing.song, patch)}
          onClose={closeEdit}
        />
      )}
      {editing?.kind === 'delete' && (
        <SongDeleteDialog
          song={editing.song}
          busy={editBusy}
          error={editErrorText}
          onDelete={() => removeSong(editing.song)}
          onClose={closeEdit}
        />
      )}
      {sheetEditing?.kind === 'rename' && (
        <SheetTitleDialog
          key={sheetEditing.sheet.id}
          title={sheetEditing.sheet.title}
          onSubmit={async (title) => {
            await updateSheetTitle(sheetEditing.sheet.id, title);
            await loadSheets();
          }}
          onClose={() => setSheetEditing(null)}
        />
      )}
      {sheetEditing?.kind === 'delete' && (
        <SheetDeleteDialog
          title={sheetEditing.sheet.title}
          onConfirm={async () => {
            const linked = sheetEditing.sheet.songId !== null;
            await deleteSheet(sheetEditing.sheet.id);
            await loadSheets();
            // 곡에 붙어 있던 악보면 그 곡 ⋯ 메뉴가 [악보 올리기]로 돌아오도록 곡 목록도 다시 읽는다
            if (linked) void load('MINE');
            showToast('악보를 지웠어요');
          }}
          onClose={() => setSheetEditing(null)}
        />
      )}
      <StudioToast text={toast} />
      <UploadDialog
        open={dialogOpen && (linkTarget !== null || !firstVisit || (SHEET_ARCHIVE_ENABLED && section === 'SHEET'))}
        locked={locked}
        onClose={closeDialog}
        section={SHEET_ARCHIVE_ENABLED && !linkTarget ? { value: section, onChange: changeSection } : undefined}
        title={linkTarget ? '곡 올리기' : undefined}
        notice={linkTarget ? `「${linkTarget.title}」 악보에 연결돼요` : undefined}
      >
        {SHEET_ARCHIVE_ENABLED && !linkTarget && section === 'SHEET' ? (
          <SheetUploadForm
            key={sheetTarget?.id ?? 'none'}
            target={sheetTarget ? { id: sheetTarget.id, title: sheetTarget.title } : null}
            onBusyChange={onSheetBusy}
            onUploaded={onSheetUploaded}
            onCancel={closeDialog}
          />
        ) : (
          panel(false)
        )}
      </UploadDialog>
    </main>
  );
}
