// 내 곡 (CHART-003, Jira 189 · CHART-002 MIDI 업로드). 헤더 [+ 곡 올리기] → 업로드 창(음원/MIDI 탭), 아래 "내 곡" 목록.
// 곡이 없는 첫 방문에는 창 없이 본문에 같은 탭 양식을 둔다(설계 CHART-002 4-1).
// 상태·폴링은 store/chartJobStore, MIDI는 store/midiUploadStore, 목록은 store/songStore. 이 페이지는 세 store를 접착한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MySongList } from '@/components/studio/MySongList';
import { UploadDialog } from '@/components/studio/UploadDialog';
import { UploadPanel, type UploadTab } from '@/components/studio/UploadPanel';
import type { MidiDraft } from '@/domain/midiUpload';
import { summarizeMineSongs, type SongSummary } from '@/domain/songCatalog';
import { useChartJob } from '@/store/chartJobStore';
import { useMidiUpload } from '@/store/midiUploadStore';
import { useSongs } from '@/store/songStore';

const JUST_DONE_MS = 2000;

const HOWTO_STEPS = [
  '음원을 접수하면 작업 대기열에 들어갑니다.',
  '드럼 트랙과 반주를 분리합니다. 원본과 드럼 트랙은 처리 후 지웁니다.',
  '드럼 트랙으로 쉬움·보통·어려움 채보를 만듭니다.',
  '완료되면 목록의 [악보 확인]·[플레이]로 바로 갈 수 있습니다.',
];
const HOWTO_MIDI = 'MIDI는 바로 채보가 만들어집니다(반주 없음).';

export function StudioPage() {
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

  const [prefill, setPrefill] = useState<{ title: string; artist: string } | null>(null);
  // 다시 올리기를 누를 때마다 올려 업로드 패널을 새로 마운트한다(프리필 반영)
  const [prefillSeq, setPrefillSeq] = useState(0);
  const [justDoneId, setJustDoneId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // 창을 다시 열면 마지막 탭을 유지한다
  const [tab, setTab] = useState<UploadTab>('AUDIO');
  const prevPhase = useRef(phase);
  const justDoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 들어오면 진행 중 작업을 복원해 폴링하고 목록을 읽는다. 나가면 타이머만 멈춘다(기록은 남는다)
  useEffect(() => {
    resume();
    void load('MINE');
    return () => {
      stopPolling();
      if (justDoneTimer.current !== null) clearTimeout(justDoneTimer.current);
    };
  }, [resume, stopPolling, load]);

  // 새 곡 행을 잠깐 강조한다
  const flashRow = useCallback((songId: number) => {
    setJustDoneId(songId);
    if (justDoneTimer.current !== null) clearTimeout(justDoneTimer.current);
    justDoneTimer.current = setTimeout(() => setJustDoneId(null), JUST_DONE_MS);
  }, []);

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

  const howto = (wide: boolean) => (
    <>
      <h3>어떻게 되나요</h3>
      <ol className={`studio-howto${wide ? ' wide' : ''}`}>
        {HOWTO_STEPS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      <p className="small dim">{HOWTO_MIDI}</p>
      <p className="small dim">반주는 본인만 들을 수 있고 다운로드·공유는 제공하지 않습니다.</p>
    </>
  );

  // 요약: 곡 n개 · 생성 중 n. 활성 작업이 목록에 아직 없으면 임시 행(MySongList)과 같이 센다
  const mine = summarizeMineSongs(items);
  const tempRow = active !== null && !items.some((s) => s.id === active.songId);
  const total = mine.total + (tempRow ? 1 : 0);
  const processing = mine.processing + (tempRow ? 1 : 0);

  return (
    <main className="main">
      <section className="hero" style={{ padding: '24px 0 18px', maxWidth: 'none' }}>
        <div className="studio-head">
          <h1>내 곡</h1>
          {!firstVisit && (
            <button type="button" className="btn-primary" onClick={() => setDialogOpen(true)}>
              + 곡 올리기
            </button>
          )}
        </div>
        {status === 'ready' && !firstVisit && (
          <p className="small dim studio-summary">
            곡 {total}개 · 생성 중 {processing}
          </p>
        )}
        <p style={{ maxWidth: 720 }}>
          드럼이 들어 있는 곡을 올리면 AI가 드럼을 분리해 세 난이도 채보를 만들고, 드럼을 뺀 반주 위에서 칠 수 있게 됩니다. MIDI는 드럼 노트로 바로
          채보를 만듭니다. 올린 곡은 여기서 관리합니다. 음원은 한 번에 한 곡씩 만들 수 있습니다.
        </p>
      </section>
      {firstVisit ? (
        <div className="col" style={{ gap: 20 }}>
          <div className="card col">
            <h3>곡 올리기</h3>
            {panel(true)}
          </div>
          <div className="card col">{howto(true)}</div>
        </div>
      ) : (
        <div className="grid-2">
          <div className="col studio-main" style={{ gap: 20 }}>
            <div className="card col">
              <MySongList
                status={status}
                items={items}
                error={listError}
                onRetry={() => void load('MINE')}
                active={active}
                progress={progress}
                justDoneId={justDoneId}
                onReupload={onReupload}
              />
            </div>
          </div>
          <div className="card col" style={{ alignSelf: 'start' }}>
            {howto(false)}
          </div>
        </div>
      )}
      <UploadDialog open={dialogOpen && !firstVisit} locked={locked} onClose={closeDialog}>
        {panel(false)}
      </UploadDialog>
    </main>
  );
}
