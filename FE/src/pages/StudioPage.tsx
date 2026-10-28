// 곡 작업실 (CHART-003, Jira 189). 음원 업로드 → 채보 생성 진행 → 완료 시 플레이 진입.
// 상태·폴링은 store/chartJobStore, 화면은 상태에 따라 입력 폼 또는 진행 카드만 고른다.
import { useEffect } from 'react';
import { AudioDropzone } from '@/components/studio/AudioDropzone';
import { JobProgressCard } from '@/components/studio/JobProgressCard';
import { useChartJob } from '@/store/chartJobStore';

export function StudioPage() {
  const { active, progress, phase, error, upload, resume, retry, clear, stopPolling } = useChartJob();

  // 들어오면 진행 중 작업을 복원해 폴링, 나가면 타이머만 멈춘다(기록은 남는다)
  useEffect(() => {
    resume();
    return () => stopPolling();
  }, [resume, stopPolling]);

  // store가 이미 사용자용 문장으로 만들어 둔다
  const errorText = error?.detail ?? null;
  // 업로드 단계의 실패(active 없음)는 폼에, 작업 자체의 실패(active 있음)는 진행 카드에 보인다
  const showCard = active !== null && progress !== null && phase !== 'idle' && phase !== 'uploading';

  return (
    <main className="main">
      <section className="hero" style={{ padding: '24px 0 18px' }}>
        <h1>곡 만들기</h1>
        <p>
          드럼이 들어 있는 곡을 올리면 AI가 드럼을 분리해 세 난이도 채보를 만들고, 드럼을 뺀 반주 위에서 칠 수 있게 됩니다. 한 번에
          한 곡씩 만들 수 있습니다.
        </p>
      </section>
      <div className="grid-2">
        <div className="card col">
          <h3>{showCard ? '채보 생성 진행' : '음원 올리기'}</h3>
          {showCard && active && progress ? (
            <JobProgressCard job={active} progress={progress} error={errorText} onClear={clear} />
          ) : (
            <AudioDropzone
              busy={phase === 'uploading'}
              error={phase === 'failed' ? errorText : null}
              retryable={error?.retryable === true}
              onSubmit={(draft) => void upload(draft)}
              onRetry={() => void retry()}
            />
          )}
        </div>
        <div className="card col">
          <h3>어떻게 되나요</h3>
          <ol className="studio-howto">
            <li>음원을 접수하면 작업 대기열에 들어갑니다.</li>
            <li>드럼 트랙과 반주를 분리합니다. 원본과 드럼 트랙은 처리 후 지웁니다.</li>
            <li>드럼 트랙으로 쉬움·보통·어려움 채보를 만듭니다.</li>
            <li>완료되면 리듬 게임·악보 연습의 "내 곡" 탭에서 고를 수 있습니다.</li>
          </ol>
          <p className="small dim">반주는 본인만 들을 수 있고 다운로드·공유는 제공하지 않습니다.</p>
        </div>
      </div>
    </main>
  );
}
