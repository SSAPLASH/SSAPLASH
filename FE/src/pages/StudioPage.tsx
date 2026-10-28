// 내 곡 (CHART-003, Jira 189). 위 "음원 올리기", 아래 "내 곡" 목록 두 섹션 (설계 4-1).
// 상태·폴링은 store/chartJobStore, 목록은 store/songStore. 이 페이지는 두 store를 접착한다(설계 3-5).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AudioDropzone } from '@/components/studio/AudioDropzone';
import { MySongList } from '@/components/studio/MySongList';
import type { SongSummary } from '@/domain/songCatalog';
import { useChartJob } from '@/store/chartJobStore';
import { useSongs } from '@/store/songStore';

const JUST_DONE_MS = 2000;

const HOWTO_STEPS = [
  '음원을 접수하면 작업 대기열에 들어갑니다.',
  '드럼 트랙과 반주를 분리합니다. 원본과 드럼 트랙은 처리 후 지웁니다.',
  '드럼 트랙으로 쉬움·보통·어려움 채보를 만듭니다.',
  '완료되면 목록의 [악보 확인]·[플레이]로 바로 갈 수 있습니다.',
];

export function StudioPage() {
  const navigate = useNavigate();
  const { active, progress, phase, error, doneSource, upload, resume, retry, clear, stopPolling } = useChartJob();
  const load = useSongs((s) => s.load);
  const scope = useSongs((s) => s.scope);
  const rawItems = useSongs((s) => s.items);
  const rawStatus = useSongs((s) => s.status);
  const listError = useSongs((s) => s.error);

  const [prefill, setPrefill] = useState<{ title: string; artist: string } | null>(null);
  // 다시 올리기를 누를 때마다 올려 드롭존을 새로 마운트한다(프리필 반영)
  const [prefillSeq, setPrefillSeq] = useState(0);
  const [justDoneId, setJustDoneId] = useState<number | null>(null);
  const dropSectionRef = useRef<HTMLDivElement>(null);
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

  // 접착 규칙: 202(업로드 → 폴링)·완료·실패에 따라 목록 재조회·이동·강조·clear
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = phase;

    if (phase === 'polling' && prev === 'uploading' && active) {
      void load('MINE');
      return;
    }
    if (phase === 'done' && active) {
      const songId = active.songId;
      if (doneSource === 'live') {
        clear();
        navigate(`/sheet?scope=MINE&song=${songId}`);
      } else if (doneSource === 'restored') {
        // 효과 안 동기 setState를 피해 한 틱 미룬다
        queueMicrotask(() => setJustDoneId(songId));
        void load('MINE');
        clear();
        if (justDoneTimer.current !== null) clearTimeout(justDoneTimer.current);
        justDoneTimer.current = setTimeout(() => setJustDoneId(null), JUST_DONE_MS);
      }
      return;
    }
    if (phase === 'failed' && error?.code === 'JOB_FAILED') {
      void load('MINE');
      clear();
    }
  }, [phase, doneSource, active, error, load, clear, navigate]);

  const onReupload = useCallback((song: SongSummary) => {
    setPrefill({ title: song.title, artist: song.artist });
    setPrefillSeq((n) => n + 1);
    dropSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // songStore가 곡 선택 창 등에서 다른 범위로 채워져 있으면 아직 안 읽은 것으로 본다
  const isMine = scope === 'MINE';
  const items = isMine ? rawItems : [];
  const status = isMine ? rawStatus : 'loading';

  // store가 이미 사용자용 문장으로 만들어 둔다
  const errorText = error?.detail ?? null;
  const firstVisit = status === 'ready' && items.length === 0 && active === null;

  const dropzone = (
    <AudioDropzone
      key={prefillSeq}
      busy={phase === 'uploading'}
      error={phase === 'failed' ? errorText : null}
      retryable={error?.retryable === true}
      onSubmit={(draft) => {
        setPrefill(null);
        void upload(draft);
      }}
      onRetry={() => void retry()}
      prefill={prefill}
      onCancelPrefill={() => setPrefill(null)}
      emphasis={firstVisit}
    />
  );

  const uploadBody =
    phase === 'polling' && active ? (
      <p className="studio-busy">「{active.title}」을 만드는 중입니다. 끝나면 다음 곡을 올릴 수 있어요.</p>
    ) : (
      dropzone
    );

  const howto = (wide: boolean) => (
    <>
      <h3>어떻게 되나요</h3>
      <ol className={`studio-howto${wide ? ' wide' : ''}`}>
        {HOWTO_STEPS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      <p className="small dim">반주는 본인만 들을 수 있고 다운로드·공유는 제공하지 않습니다.</p>
    </>
  );

  const uploadSection = (
    <div className="card col" ref={dropSectionRef}>
      <h3>음원 올리기</h3>
      {uploadBody}
    </div>
  );

  return (
    <main className="main">
      <section className="hero" style={{ padding: '24px 0 18px' }}>
        <h1>내 곡</h1>
        <p>
          드럼이 들어 있는 곡을 올리면 AI가 드럼을 분리해 세 난이도 채보를 만들고, 드럼을 뺀 반주 위에서 칠 수 있게 됩니다. 올린 곡은 여기서
          관리합니다. 한 번에 한 곡씩 만들 수 있습니다.
        </p>
      </section>
      {firstVisit ? (
        <div className="col" style={{ gap: 20 }}>
          {uploadSection}
          <div className="card col">{howto(true)}</div>
        </div>
      ) : (
        <div className="grid-2">
          <div className="col studio-main" style={{ gap: 20 }}>
            {uploadSection}
            <div className="card col">
              <h3>내 곡</h3>
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
    </main>
  );
}
