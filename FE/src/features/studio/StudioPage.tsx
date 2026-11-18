// 곡 반주 듣기(재생바·제목 흐름)는 설계 CHART-003 라이브러리 재생바(S15P31A307-327).
// 라이브러리 (CHART-003, Jira 189 · CHART-002 MIDI 업로드 · Figma 207:2110 외). 헤더 [올리기] → 업로드 창(음원/MIDI 탭), 아래 목록(카드·목록 보기).
// 곡·악보가 하나도 없으면 같은 틀에 목록 자리만 빈 안내로 둔다(설계 QA-studio-empty-state).
// 상태·폴링은 store/chartJobStore, MIDI는 store/midiUploadStore, 목록은 store/songStore. 이 페이지는 세 store를 접착한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { deleteSheet, updateSheetTitle } from '@/features/studio/api/sheets';
import { sheetKeys, sheetListQuery } from '@/features/studio/api/queries/sheets';
import { mineSongsQuery, songKeys } from '@/api/song/songQueries';
import { ApiError } from '@/api/http';
import { getSong, retryMidiAccompaniment } from '@/api/song/songs';
import { queryClient } from '@/runtime/queryClient';
import { useApiQuery } from '@/runtime/useApiQuery';
import { SHEET_RELINK_ENABLED } from '@/config/features';
import { SheetDeleteDialog } from '@/features/studio/components/sheet/SheetDeleteDialog';
import { SheetTitleDialog } from '@/features/studio/components/sheet/SheetTitleDialog';
import { useFreeAccompaniment } from '@/components/song/useFreeAccompaniment';
import { useShell } from '@/components/shell/nav/useShell';
import { Button } from '@/components/ui/action/Button';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { Segmented } from '@/components/ui/form/Segmented';
import { MySongList, type StudioView } from '@/features/studio/components/songs/MySongList';
import type { SheetMenuKind } from '@/features/studio/components/sheet/SheetMenu';
import { SheetUploadForm } from '@/features/studio/components/upload/SheetUploadForm';
import { SongCoverDialog } from '@/features/studio/components/songs/SongCoverDialog';
import { SongDeleteDialog } from '@/features/studio/components/songs/SongDeleteDialog';
import { SongMetaDialog } from '@/features/studio/components/songs/SongMetaDialog';
import { StudioToast } from '@/features/studio/components/StudioToast';
import { patchCachedSong, useAccompanimentPolling } from '@/features/studio/components/accompaniment/useAccompanimentPolling';
import type { SongEditKind, SongSheetKind } from '@/features/studio/components/songs/SongMenu';
import { PlusIcon } from '@/components/song/StudioIcons';
import { UploadDialog, type UploadSection } from '@/features/studio/components/upload/UploadDialog';
import { UploadPanel, type UploadTab } from '@/features/studio/components/upload/UploadPanel';
import type { MidiDraft } from '@/domain/song/midiUpload';
import type { SheetSummary } from '@/features/studio/domain/sheetMusic';
import { summarizeMineSongs, type SongSummary } from '@/domain/song/songCatalog';
import { coverRefreshDue, type CoverChange } from '@/features/studio/domain/songCover';
import type { SongMetaPatch } from '@/domain/song/songEdit';
import type { SongPlayback } from '@/features/studio/domain/songPlayback';
import { useChartJob } from '@/store/chartJobStore';
import { useMidiUpload } from '@/features/studio/store/midiUploadStore';
import { useSheetLink } from '@/features/studio/store/sheetLinkStore';
import { useSongEdit } from '@/features/studio/store/songEditStore';
import { useSongs } from '@/store/songStore';
import { useAuth } from '@/store/authStore';

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
  // 내 곡·악보 목록은 서버 데이터 캐시로 읽는다(설계 TECH-351). 저장·삭제 뒤에는 무효화해 다시 받는다
  const songsSource = useSongs((s) => s.source);
  const mineList = useApiQuery(mineSongsQuery(songsSource));
  const listError = mineList.error;
  const reloadSongs = useCallback(() => queryClient.invalidateQueries({ queryKey: songKeys.all }), []);
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
  const sheetList = useApiQuery(sheetListQuery());
  const sheets: SheetSummary[] = useMemo(() => sheetList.data?.items ?? [], [sheetList.data]);
  const sheetsStatus = sheetList.status;
  const [section, setSection] = useState<UploadSection>(loadSection);
  // 곡 ⋯ [악보 올리기]로 열었을 때 붙일 곡(헤더에서 열면 null)
  const [sheetTarget, setSheetTarget] = useState<SongSummary | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const sheetBusyRef = useRef(false);
  const [sheetEditing, setSheetEditing] = useState<SheetEditing | null>(null);
  // 창을 다시 열면 마지막 탭을 유지한다
  const [tab, setTab] = useState<UploadTab>('AUDIO');
  const prevPhase = useRef(phase);
  const justDoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryingAccompanimentIds, setRetryingAccompanimentIds] = useState<ReadonlySet<number>>(() => new Set());
  const retryingAccompanimentRef = useRef(new Set<number>());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 커버 오류로 목록을 마지막으로 다시 읽은 시각(U10)
  const coverRefreshAt = useRef<number | null>(null);

  // 들어오면 진행 중 작업을 복원해 폴링한다(목록은 쿼리가 읽는다). 나가면 타이머만 멈춘다(기록은 남는다).
  // 곡 선택 창은 라이브러리를 다녀오면 내 곡 탭으로 열린다(기존 동작, 설계 TECH-350 U4)
  useEffect(() => {
    resume();
    useSongs.setState({ scope: 'MINE' });
    return () => {
      stopPolling();
      if (justDoneTimer.current !== null) clearTimeout(justDoneTimer.current);
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    };
  }, [resume, stopPolling]);

  const loadSheets = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: sheetKeys.all });
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
      await Promise.all([reloadSongs(), loadSheets()]);
      if (useSheetLink.getState().phase === 'done') showToast('곡을 올리고 악보를 연결했어요');
    },
    [reloadSongs, loadSheets, showToast],
  );
  const linkToSong = useCallback((songId: number) => finishLink(() => useSheetLink.getState().link(songId)), [finishLink]);
  const retryLink = useCallback(() => void finishLink(() => useSheetLink.getState().retry()), [finishLink]);

  // 뷰어에서 악보를 지우고 돌아오면(라우터 state) 토스트를 보이고 state를 비운다(새로고침해도 다시 뜨지 않게)
  const sheetDeletedFlag = (location.state as { sheetDeleted?: boolean } | null)?.sheetDeleted === true;
  useEffect(() => {
    if (!sheetDeletedFlag) return;
    queueMicrotask(() => showToast('악보를 지웠어요'));
    navigate(location.pathname, { replace: true, state: null });
  }, [sheetDeletedFlag, navigate, location.pathname, showToast]);

  // 서명 URL이 만료돼 커버를 못 불러오면 목록을 다시 읽어 새 URL을 받는다. 카드 여럿이 한꺼번에 실패해도 1분에 한 번만
  const onCoverError = useCallback(() => {
    const now = Date.now();
    if (!coverRefreshDue(coverRefreshAt.current, now)) return;
    coverRefreshAt.current = now;
    void reloadSongs();
  }, [reloadSongs]);

  // 접착 규칙: 202(업로드 → 폴링)·완료·실패에 따라 창 닫기·목록 재조회·이동·강조·clear
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = phase;

    if (phase === 'polling' && prev === 'uploading' && active) {
      // 효과 안 동기 setState를 피해 한 틱 미룬다
      queueMicrotask(() => setDialogOpen(false));
      void reloadSongs();
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
      // 채보가 끝나도 라이브러리에 머문다(QA): 목록을 다시 읽고 그 곡을 잠깐 강조한다. 지켜보던 중 끝났으면 알림도 띄운다
      const { songId, title } = active;
      if (doneSource === 'live' || doneSource === 'restored') {
        queueMicrotask(() => {
          flashRow(songId);
          if (doneSource === 'live') showToast(`「${title}」 악보가 만들어졌어요`);
        });
        void reloadSongs();
        clear();
      }
      return;
    }
    if (phase === 'failed' && error?.code === 'JOB_FAILED') {
      void reloadSongs();
      clear();
    }
  }, [phase, doneSource, active, error, reloadSongs, clear, flashRow, showToast, linkToSong]);

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
        await Promise.all([reloadSongs(), removed && song.sheetId != null ? loadSheets() : undefined]);
        if (removed) showToast(`「${song.title}」을 삭제했습니다.`);
        else flashRow(song.id);
      } else if (p === 'failed' && (err?.uncertain || err?.code === 'SONG_NOT_FOUND')) {
        void reloadSongs();
      }
    },
    [editReset, clear, reloadSongs, loadSheets, flashRow, showToast],
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
  const openUpload = useCallback(() => {
    useSheetLink.getState().cancel();
    setSheetTarget(null);
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
    void reloadSongs();
    void loadSheets();
    showToast('악보를 올렸어요');
  }, [reloadSongs, loadSheets, showToast]);

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
        else await reloadSongs();
        flashRow(song.id);
      } else if (p === 'failed' && err?.uncertain) {
        void reloadSongs();
      }
    },
    [midiUpload, midiReset, reloadSongs, flashRow, linkToSong],
  );

  const items = useMemo(() => mineList.data ?? [], [mineList.data]);
  const status = mineList.status;
  // 곡 반주 듣기(설계 CHART-003 라이브러리 재생바). 자유 연습의 반주 훅 하나를 써서 한 번에 한 곡만 울리고, 화면을 떠나면 훅이 해제한다
  const {
    view: listenView,
    pick: listenPick,
    pause: listenPause,
    resume: listenResume,
    seek: listenSeek,
    off: listenOff,
    retry: listenRetry,
    available: listenAvailable,
  } = useFreeAccompaniment();
  const playback = useMemo<SongPlayback>(
    () => ({
      view: listenView,
      onListen: (song) => listenPick({ songId: song.id, title: song.title, artist: song.artist || null, coverUrl: song.coverUrl }),
      onPause: listenPause,
      onResume: listenResume,
      onSeek: listenSeek,
      onRetry: listenRetry,
    }),
    [listenView, listenPick, listenPause, listenResume, listenSeek, listenRetry],
  );
  // 듣던 곡이 목록에서 사라지면(삭제) 끈다
  const listeningId = listenView.pick?.songId ?? null;
  useEffect(() => {
    if (listeningId !== null && status === 'ready' && !items.some((s) => s.id === listeningId)) listenOff();
  }, [listeningId, status, items, listenOff]);
  // 채보는 READY인데 반주가 생성 중인 곡만 짧게 다시 읽어 배지를 갱신한다(설계 CHART-002 반주 상태 4-2)
  const restartAccompanimentPolling = useAccompanimentPolling(items, status === 'ready');

  const onRetryAccompaniment = useCallback(async (song: SongSummary) => {
    const auth = useAuth.getState();
    const userId = auth.status === 'authenticated' ? auth.user?.id : undefined;
    if (userId == null || song.source !== 'MIDI' || song.status !== 'READY' || song.accompanimentStatus !== 'FAILED' || retryingAccompanimentRef.current.has(song.id)) return;
    const sameUser = () => useAuth.getState().status === 'authenticated' && useAuth.getState().user?.id === userId;
    retryingAccompanimentRef.current.add(song.id);
    setRetryingAccompanimentIds(new Set(retryingAccompanimentRef.current));
    try {
      let conflict = false;
      try {
        await retryMidiAccompaniment(song.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && error.code === 'MIDI_RETRY_UNAVAILABLE') conflict = true;
        else throw error;
      }
      if (!sameUser()) return;
      // 상세 조회가 실패하더라도 목록 재조회에서 GENERATING을 발견하면 폴링이 다시 시작된다.
      restartAccompanimentPolling(song.id);
      try {
        const latest = await getSong(song.id);
        if (!sameUser()) return;
        patchCachedSong(latest);
      } catch {
        if (!sameUser()) return;
        void reloadSongs();
        showToast(conflict ? '현재 반주 상태를 확인하지 못했어요' : '반주 재시도 요청은 접수됐지만 상태를 확인하지 못했어요');
        return;
      }
      showToast(conflict ? '이미 처리 중이거나 반주를 다시 만들 수 없어요' : '반주 생성을 다시 시작했어요');
    } catch (error) {
      if (!sameUser()) return;
      if (error instanceof ApiError && error.status === 404) {
        showToast('곡을 찾을 수 없어요');
        void reloadSongs();
      } else if (error instanceof ApiError && error.status === 401) {
        showToast('다시 로그인해 주세요');
      } else {
        showToast('반주 생성을 다시 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요');
      }
    } finally {
      retryingAccompanimentRef.current.delete(song.id);
      setRetryingAccompanimentIds(new Set(retryingAccompanimentRef.current));
    }
  }, [reloadSongs, restartAccompanimentPolling, showToast]);

  // store가 이미 사용자용 문장으로 만들어 둔다
  const errorText = error?.detail ?? null;
  const jobLookupError = phase === 'failed' && active !== null && (error?.code === 'AUDIO_NOT_FOUND' || error?.code === 'JOB_AUTH');
  const displayedActive = jobLookupError ? null : active;
  // 빈 안내는 악보까지 없을 때만. 악보 목록을 읽는 동안에는 판단을 미룬다(안내가 잠깐 떴다 사라지지 않게)
  const sheetsEmpty = sheetsStatus === 'error' || (sheetsStatus === 'ready' && sheets.length === 0);
  const libraryEmpty = status === 'ready' && items.length === 0 && displayedActive === null && sheetsEmpty;
  const audioBusyTitle = phase === 'polling' && active ? active.title : null;

  const panel = () => (
    <UploadPanel
      key={`${prefillSeq}-${linkTarget?.id ?? 'none'}`}
      initialTitle={linkTarget?.title}
      tab={tab}
      onTab={setTab}
      locked={locked}
      onCancel={closeDialog}
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
  if (status === 'loading') summary = '불러오는 중…';
  else if (status === 'error') summary = '목록을 불러오지 못했어요';
  else {
    summary = processing > 0 ? `곡 ${total}개 · 생성 중 ${processing}` : `곡 ${total}개`;
    if (sheets.length > 0) summary += ` · 악보 ${sheets.length}개`;
  }

  // 카드·목록 보기 모두 본문 전체 폭(안내 패널은 없앴다, 설계 QA-363). 카드 보기는 제목 아래 간격만 넓다
  const cardView = status === 'ready' && view === 'card';

  return (
    <main className={`main studio-page${cardView ? ' roomy' : ''}`}>
      {/* 요약은 제목 오른쪽 작은 글씨. 올리기 진입점은 곡이 없을 때도 이 버튼 하나다(설계 QA-studio-empty-state·QA-page-header-dock-fold) */}
      <PageHeader
        title="라이브러리"
        meta={summary}
        actions={
          <Button variant="primary" size="md" className="studio-upload-btn" leadingIcon={<PlusIcon />} onClick={openUpload}>
            올리기
          </Button>
        }
      />
      {jobLookupError && <p className="notice error" role="alert">{errorText}</p>}
      {SHEET_RELINK_ENABLED && linkPending !== null && (
        <p className="notice error" role="alert">
          곡은 올렸지만 악보를 연결하지 못했어요
          <Button variant="text" size="sm" disabled={linkPhase === 'linking'} onClick={retryLink}>
            다시 연결
          </Button>
        </p>
      )}
      <div className="studio-body">
        <div className="studio-main-col">
          <div className="studio-toolbar">
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
            onRetry={() => void reloadSongs()}
            active={displayedActive}
            progress={progress}
            justDoneId={justDoneId}
            onReupload={onReupload}
            onRetryAccompaniment={onRetryAccompaniment}
            retryingAccompanimentIds={retryingAccompanimentIds}
            view={view}
            onEdit={openEdit}
            onCoverError={onCoverError}
            sheets={sheets}
            sheetsFailed={sheetsStatus === 'error'}
            onSheetsRetry={() => void loadSheets()}
            onSheetMenu={onSheetMenu}
            onSheetCoverError={() => void loadSheets()}
            onSongSheet={onSongSheet}
            onUploadSong={SHEET_RELINK_ENABLED ? onUploadSong : undefined}
            empty={libraryEmpty}
            playback={listenAvailable ? playback : undefined}
          />
        </div>
      </div>
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
            if (linked) void reloadSongs();
            showToast('악보를 지웠어요');
          }}
          onClose={() => setSheetEditing(null)}
        />
      )}
      <StudioToast text={toast} />
      <UploadDialog
        open={dialogOpen}
        locked={locked}
        onClose={closeDialog}
        section={!linkTarget ? { value: section, onChange: changeSection } : undefined}
        title={linkTarget ? '곡 올리기' : undefined}
        notice={linkTarget ? `「${linkTarget.title}」 악보에 연결돼요` : undefined}
      >
        {!linkTarget && section === 'SHEET' ? (
          <SheetUploadForm
            key={sheetTarget?.id ?? 'none'}
            target={sheetTarget ? { id: sheetTarget.id, title: sheetTarget.title } : null}
            onBusyChange={onSheetBusy}
            onUploaded={onSheetUploaded}
            onCancel={closeDialog}
          />
        ) : (
          panel()
        )}
      </UploadDialog>
    </main>
  );
}
