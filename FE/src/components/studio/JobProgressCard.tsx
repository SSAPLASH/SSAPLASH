// 채보 생성 진행 카드 (설계 CHART-ACCT D2). 4칸(접수·분리·생성·완료) 고정. 폴링만 있을 때(stageKnown=false)는
// 분리·생성 두 칸을 함께 "처리 중"으로 보인다. store를 구독하지 않고 props만 그린다.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { JOB_STAGE_ORDER, STAGE_LABEL, type ActiveJob, type JobProgress } from '@/domain/chartJob';
import { formatDuration } from '@/components/formatTime';

/** 이보다 오래 처리 중이면 안내를 덧붙인다 (설계 4-2) */
const LONG_RUNNING_MS = 24 * 60 * 60 * 1000;

interface Props {
  job: ActiveJob;
  progress: JobProgress;
  /** 폴링 단계에서 난 오류 문구(FAILED 사유 포함) */
  error: string | null;
  onClear: () => void;
}

function elapsedMs(startedAt: string, now: number): number {
  const t = Date.parse(startedAt);
  return Number.isFinite(t) ? Math.max(0, now - t) : 0;
}

export function JobProgressCard({ job, progress, error, onClear }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const running = progress.stage !== 'DONE' && progress.stage !== 'FAILED';

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = elapsedMs(job.startedAt, now);
  const stageIndex = progress.stage === 'FAILED' ? -1 : JOB_STAGE_ORDER.indexOf(progress.stage);
  // 단계를 모르면(폴링) 분리·생성 칸을 같이 진행 중으로 칠한다
  const activeSet = new Set<number>(
    progress.stageKnown ? [stageIndex] : [JOB_STAGE_ORDER.indexOf('SEPARATING'), JOB_STAGE_ORDER.indexOf('TRANSCRIBING')],
  );

  return (
    <div className="studio-progress col">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{job.title}</strong>
        <span className="small dim">{running ? `경과 ${formatDuration(elapsed)}` : STAGE_LABEL[progress.stage]}</span>
      </div>

      <ol className="studio-steps" aria-label="진행 단계">
        {JOB_STAGE_ORDER.map((s, i) => {
          // 단계를 모르는 처리 중(폴링)에도 접수는 끝난 것이므로 접수됨 칸은 완료로 둔다
          const done = progress.stage === 'DONE' || (progress.stageKnown ? i < stageIndex : s === 'QUEUED');
          const active = running && activeSet.has(i);
          const cls = done ? 'done' : active ? 'active' : '';
          return (
            <li key={s} className={cls} aria-current={active ? 'step' : undefined}>
              <span className="studio-step-dot" />
              <span>{s === 'DONE' ? '완료' : STAGE_LABEL[s]}</span>
            </li>
          );
        })}
      </ol>

      {running && (
        <p className="small dim">
          {progress.stageKnown ? STAGE_LABEL[progress.stage] : '처리 중'}
          {progress.percent !== null ? ` · ${Math.round(progress.percent)}%` : ''} — 3분 곡 기준 2분쯤 걸립니다. 이 화면을 닫아도 작업은
          계속되고, 다시 들어오면 이어서 보입니다.
        </p>
      )}
      {running && elapsed > LONG_RUNNING_MS && (
        <p className="notice">하루 넘게 처리 중입니다. 서버 쪽 문제일 수 있으니 팀에 문의해 주세요.</p>
      )}

      {progress.stage === 'FAILED' && (
        <div className="notice error" role="alert">
          {error ?? progress.failReason ?? '채보를 만들지 못했습니다.'}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {progress.stage === 'DONE' && (
          <Link to="/play?scope=MINE" className="btn-primary">
            리듬 게임에서 플레이
          </Link>
        )}
        {!running && (
          <button className="btn-ghost" onClick={onClear}>
            다른 곡 올리기
          </button>
        )}
      </div>
    </div>
  );
}
