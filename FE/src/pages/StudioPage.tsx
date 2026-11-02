// 라이브러리 (CHART-003, Jira 189 · CHART-002 MIDI 업로드 · Figma 207:2110 외). 헤더 [곡 올리기] → 업로드 창(음원/MIDI 탭), 아래 목록(카드·목록 보기)과 안내 패널.
// 곡이 없는 첫 방문에는 창 없이 본문에 같은 탭 양식을 둔다(설계 CHART-002 4-1).
// 상태·폴링은 store/chartJobStore, MIDI는 store/midiUploadStore, 목록은 store/songStore. 이 페이지는 세 store를 접착한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SONG_EDIT_ENABLED } from '@/app/features';
import { useShell } from '@/components/shell/useShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { HowtoPanel } from '@/components/studio/HowtoPanel';
import { MySongList, type StudioView } from '@/components/studio/MySongList';
import { SongCoverDialog } from '@/components/studio/SongCoverDialog';
import { SongDeleteDialog } from '@/components/studio/SongDeleteDialog';
import { SongMetaDialog } from '@/components/studio/SongMetaDialog';
import { StudioToast } from '@/components/studio/StudioToast';
import type { SongEditKind } from '@/components/studio/SongMenu';
import { PlusIcon } from '@/components/studio/StudioIcons';
import { UploadDialog } from '@/components/studio/UploadDialog';
import { UploadPanel, type UploadTab } from '@/components/studio/UploadPanel';
import type { MidiDraft } from '@/domain/midiUpload';
import { summarizeMineSongs, type SongSummary } from '@/domain/songCatalog';
import { coverRefreshDue, type CoverChange } from '@/domain/songCover';
import type { SongMetaPatch } from '@/domain/songEdit';
import { useChartJob } from '@/store/chartJobStore';
import { useMidiUpload } from '@/store/midiUploadStore';
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

interface Editing {
  kind: SongEditKind;
  song: SongSummary;
}

export function StudioPage() {
  useShell({ title: '라이브러리' });
  const navigate = useNavigate();
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
  }, [phase, doneSource, active, error, load, clear, navigate, flashRow]);

  const onReupload = useCallback((song: SongSummary) => {
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
        await load('MINE');
        if (removed) showToast(`「${song.title}」을 삭제했습니다.`);
        else flashRow(song.id);
      } else if (p === 'failed' && (err?.uncertain || err?.code === 'SONG_NOT_FOUND')) {
        void load('MINE');
      }
    },
    [editReset, clear, load, flashRow, showToast],
  );

  const saveMeta = (song: SongSummary, patch: SongMetaPatch) =>
    void runEdit(song, () => useSongEdit.getState().saveMeta(song.id, patch), false);
  const saveCover = (song: SongSummary, change: CoverChange) =>
    void runEdit(song, () => useSongEdit.getState().saveCover(song.id, change), false);
  const removeSong = (song: SongSummary) => void runEdit(song, () => useSongEdit.getState().remove(song.id), true);

  const editBusy = editPhase === 'saving';
  const editErrorText = editPhase === 'failed' ? (editError?.text ?? null) : null;

  const locked = phase === 'uploading' || midiPhase === 'uploading';

  // 업로드 중에는 닫지 않는다. 닫을 때 MIDI 실패 문구는 비워 다음에 열 때 남지 않게 한다
  const closeDialog = useCallback(() => {
    if (useChartJob.getState().phase === 'uploading' || useMidiUpload.getState().phase === 'uploading') return;
    if (useMidiUpload.getState().phase === 'failed') midiReset();
    setDialogOpen(false);
  }, [midiReset]);

  // MIDI는 작업(job) 없이 동기 처리다: 201이면 창을 닫고 목록을 다시 읽어 새 곡 행을 강조한다(이동 없음).
  // 결과를 모르는 실패(네트워크·5xx)는 서버에 저장됐을 수 있어 목록도 다시 읽는다
  const onMidiSubmit = useCallback(
    async (draft: MidiDraft) => {
      await midiUpload(draft);
      const { phase: p, song, error: err } = useMidiUpload.getState();
      if (p === 'done' && song) {
        setDialogOpen(false);
        midiReset();
        await load('MINE');
        flashRow(song.id);
      } else if (p === 'failed' && err?.uncertain) {
        void load('MINE');
      }
    },
    [midiUpload, midiReset, load, flashRow],
  );

  // songStore가 곡 선택 창 등에서 다른 범위로 채워져 있으면 아직 안 읽은 것으로 본다
  const isMine = scope === 'MINE';
  const items = isMine ? rawItems : [];
  const status = isMine ? rawStatus : 'loading';

  // store가 이미 사용자용 문장으로 만들어 둔다
  const errorText = error?.detail ?? null;
  const firstVisit = status === 'ready' && items.length === 0 && active === null;
  const audioBusyTitle = phase === 'polling' && active ? active.title : null;

  const panel = (emphasis: boolean) => (
    <UploadPanel
      key={prefillSeq}
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
  const tempRow = active !== null && !items.some((s) => s.id === active.songId);
  const total = mine.total + (tempRow ? 1 : 0);
  const processing = mine.processing + (tempRow ? 1 : 0);
  let summary: string;
  if (status === 'idle' || status === 'loading') summary = '불러오는 중…';
  else if (status === 'error') summary = '목록을 불러오지 못했어요';
  else if (firstVisit) summary = '아직 올린 곡이 없어요. 음원이나 MIDI를 올리면 드럼 악보를 만들어 드려요.';
  else summary = processing > 0 ? `곡 ${total}개 · 생성 중 ${processing}` : `곡 ${total}개`;

  // 안내 패널은 카드 보기에서만 오른쪽에 둔다(목록 보기·로딩·오류는 본문 전체 폭, Figma 225:4551·225:5042·225:5368)
  const split = status === 'ready' && view === 'card';

  return (
    <main className={`main studio-page${split || firstVisit ? ' roomy' : ''}`}>
      <header className="studio-head">
        <div className="studio-head-title">
          <h2 className="t-title-24">라이브러리</h2>
          <p className="studio-summary">{summary}</p>
        </div>
        {!firstVisit && (
          <Button variant="primary" size="md" className="studio-upload-btn" leadingIcon={<PlusIcon />} onClick={() => setDialogOpen(true)}>
            곡 올리기
          </Button>
        )}
      </header>
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
              active={active}
              progress={progress}
              justDoneId={justDoneId}
              onReupload={onReupload}
              view={view}
              onEdit={SONG_EDIT_ENABLED ? openEdit : undefined}
              onCoverError={onCoverError}
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
      <StudioToast text={toast} />
      <UploadDialog open={dialogOpen && !firstVisit} locked={locked} onClose={closeDialog}>
        {panel(false)}
      </UploadDialog>
    </main>
  );
}
