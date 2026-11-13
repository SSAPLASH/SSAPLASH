// PENDING 리포트 재조회 타이머 (COACH-003 4-1). React에 의존하지 않아 fake timers로 검증한다.
// interval마다 refresh를 호출해 결과를 알리고, PENDING이 아니면 즉시 멈춘다. max회 뒤에도 PENDING이면 onExhausted.
import type { Report } from '@/domain/play/report';

export interface AnalysisPollerOptions {
  intervalMs: number;
  max: number;
  refresh: () => Promise<Report>;
  onReport: (report: Report) => void;
  onExhausted: () => void;
}

export interface AnalysisPoller {
  /** 횟수를 0부터 다시 세어 시작한다 */
  start: () => void;
  /** 타이머를 해제하고 이후 결과는 무시한다 */
  stop: () => void;
}

export function createAnalysisPoller(opts: AnalysisPollerOptions): AnalysisPoller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  const schedule = (done: number) => {
    timer = setTimeout(async () => {
      timer = null;
      let pending = true;
      try {
        const report = await opts.refresh();
        if (!alive) return;
        opts.onReport(report);
        pending = report.analysisStatus === 'PENDING';
      } catch {
        // 실패는 횟수만 소모하고 넘어간다
        if (!alive) return;
      }
      if (!pending) return;
      if (done + 1 >= opts.max) opts.onExhausted();
      else schedule(done + 1);
    }, opts.intervalMs);
  };

  return {
    start: () => {
      if (timer) clearTimeout(timer);
      alive = true;
      schedule(0);
    },
    stop: () => {
      alive = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
