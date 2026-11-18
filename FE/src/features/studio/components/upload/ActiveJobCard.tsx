// Figma Studio / ActiveJobCard 203:665 — 생성 중(활성 작업) 카드. 목록 맨 위 한 줄 전체 폭에 4단계 진행 띠(접수·드럼 분리·채보 생성·완료)와 경과 시간을 보인다.
// 세부 단계를 모르면 분리·생성 두 칸을 함께 진행 중으로 칠한다. store를 구독하지 않고 props만 그린다.
import { useEffect, useState } from 'react';
import { JOB_STAGE_ORDER, STAGE_LABEL, type ActiveJob, type JobProgress } from '@/domain/song/chartJob';
import { SongCover } from '@/components/song/SongCover';
import { SongStatusBadge } from '@/components/song/SongStatusBadge';

/** 이보다 오래 처리 중이면 안내를 덧붙인다 (설계 CHART-003 4-2) */
const LONG_RUNNING_MS = 24 * 60 * 60 * 1000;

interface Props {
  job: ActiveJob;
  progress: JobProgress;
}

function elapsedMs(startedAt: string, now: number): number {
  const t = Date.parse(startedAt);
  return Number.isFinite(t) ? Math.max(0, now - t) : 0;
}

/** 1분 12초 형식 (Figma elapsed) */
function elapsedLabel(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}분 ${s % 60}초`;
}

export function ActiveJobCard({ job, progress }: Props) {
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
    <section className="studio-job" aria-label={`「${job.title}」 생성 진행`}>
      <div className="studio-job-cover">
        <SongCover coverUrl={null} />
      </div>
      <div className="studio-job-body">
        <div className="studio-job-title-row">
          <span className="studio-job-title" title={job.title}>
            {job.title}
          </span>
          <SongStatusBadge status="PROCESSING" />
        </div>
        <ol className="studio-job-steps" aria-label="진행 단계">
          {JOB_STAGE_ORDER.map((s, i) => {
            // 단계를 모르는 처리 중(폴링)에도 접수는 끝난 것이므로 접수됨 칸은 완료로 둔다
            const done = progress.stage === 'DONE' || (progress.stageKnown ? i < stageIndex : s === 'QUEUED');
            const active = running && activeSet.has(i);
            const cls = done ? 'done' : active ? 'active' : '';
            return (
              <li key={s} className={`studio-job-step ${cls}`} aria-current={active ? 'step' : undefined}>
                <span className="studio-job-bar" />
                <span className="studio-job-step-label">
                  {i + 1}. {s === 'QUEUED' ? '접수' : STAGE_LABEL[s]}
                </span>
              </li>
            );
          })}
        </ol>
        {progress.percent !== null && (
          <div className="studio-job-percent" role="progressbar" aria-label="채보 생성 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
            진행률 {progress.percent}%
          </div>
        )}
        {running && elapsed > LONG_RUNNING_MS && (
          <p className="notice">하루 넘게 처리 중입니다. 서버 쪽 문제일 수 있으니 팀에 문의해 주세요.</p>
        )}
      </div>
      <div className="studio-job-elapsed">
        <span className="studio-job-elapsed-label">경과</span>
        <span className="studio-job-elapsed-time">{elapsedLabel(elapsed)}</span>
      </div>
    </section>
  );
}
