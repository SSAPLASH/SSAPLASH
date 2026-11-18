// 연주 중 LLM 구간 코칭의 요청·조회·기한(설계 COACH-001 연주 중 LLM 코칭 4.1·4.2·4.4).
// 끝난 구간의 사실을 BE에 보내고 0.5초마다 결과를 조회한다. 기한(다음 구간 길이의 절반) 안에 온 문구만 넘기고,
// 늦은 문구는 LATE로 기록하고 버린다. 상한 초과(429) 뒤에는 그 판의 남은 구간을 요청하지 않는다.
// 네트워크와 시계는 주입받는다(시험에서 가짜로 바꾼다). 코칭 오류가 연주를 막지 않도록 예외를 밖으로 내지 않는다.
import type { FinishedSegment, LiveTipText } from './segment';

export type LlmMode = 'shadow' | 'on';
export type LlmStatus = 'SHOWN' | 'SHADOW' | 'LATE' | 'FAILED' | 'SKIPPED';

export interface LlmRequestResult {
  requestId: string;
}

export type LlmPollResult = { kind: 'pending' } | { kind: 'done'; title: string; sub: string; model: string; generationMs: number } | { kind: 'gone' };

/** BE 호출. 요청은 꺼져 있으면 null, 상한 초과면 'limit' */
export interface LlmCoachClient {
  request(runId: string, facts: FinishedSegment['facts']): Promise<LlmRequestResult | null | 'limit'>;
  poll(requestId: string): Promise<LlmPollResult>;
}

export interface LlmTip extends LiveTipText {
  segment: number;
  model: string;
  latencyMs: number;
  /** 이 시간 안에 띄우지 못하면 버린다 */
  expiresInMs: number;
}

export interface LlmRecord {
  segment: number;
  status: LlmStatus;
  title?: string;
  sub?: string;
  model?: string;
  latencyMs?: number;
}

export interface LlmCoachOptions {
  client: LlmCoachClient;
  mode: LlmMode;
  runId: string;
  /** 기한 안에 온 문구. mode가 on일 때만 부른다. expiresInMs가 지나도록 못 띄우면 받는 쪽이 LATE로 남긴다 */
  onTip: (tip: LlmTip) => void;
  /** 구간마다 한 번 결과를 남긴다(LIVE_LLM) */
  onRecord: (r: LlmRecord) => void;
  /** 단조 시계(ms). 기본 performance.now */
  now?: () => number;
  /** 기다리기. 기본 setTimeout */
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
}

const DEFAULT_POLL_MS = 500;

export class LlmCoach {
  private readonly opts: Required<Omit<LlmCoachOptions, 'now' | 'sleep' | 'pollMs'>> & { now: () => number; sleep: (ms: number) => Promise<void>; pollMs: number };
  /** 다시 하기·종료 때 늘린다. 앞선 판의 결과를 버리는 데 쓴다 */
  private generation = 0;
  private limited = false;
  private runId: string;

  constructor(opts: LlmCoachOptions) {
    this.opts = {
      ...opts,
      now: opts.now ?? (() => performance.now()),
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      pollMs: opts.pollMs ?? DEFAULT_POLL_MS,
    };
    this.runId = opts.runId;
  }

  /** 끝난 구간 하나를 요청하고 결과를 기다린다. 끝날 때까지 기다리는 Promise를 돌려준다(시험용) */
  submit(seg: FinishedSegment): Promise<void> {
    return this.run(seg).catch(() => this.record(seg, 'FAILED'));
  }

  /** 다시 하기·종료·코칭 끔. 기다리던 결과는 와도 넘기지 않는다. 다시 하기면 새 판 번호를 준다(판당 상한을 새로 센다) */
  cancel(nextRunId?: string): void {
    this.generation += 1;
    this.limited = false;
    if (nextRunId) this.runId = nextRunId;
  }

  private record(seg: FinishedSegment, status: LlmStatus, extra: Omit<LlmRecord, 'segment' | 'status'> = {}): void {
    try {
      this.opts.onRecord({ segment: seg.facts.segment.index, status, ...extra });
    } catch {
      // 기록 오류로 연주를 막지 않는다
    }
  }

  private async run(seg: FinishedSegment): Promise<void> {
    const gen = this.generation;
    const { client, now, sleep, pollMs } = this.opts;
    const runId = this.runId;
    if (this.limited) return this.record(seg, 'SKIPPED');
    const started = now();
    // 응답 기한: 다음 구간 길이의 절반. 그 뒤 문구는 이미 지난 이야기다
    const deadline = started + Math.max(1_000, seg.nextDurationMs / 2);
    let req: LlmRequestResult | null | 'limit';
    try {
      req = await client.request(runId, seg.facts);
    } catch {
      if (gen === this.generation) this.record(seg, 'SKIPPED');
      return;
    }
    if (gen !== this.generation) return;
    if (req === 'limit') {
      this.limited = true;
      return this.record(seg, 'SKIPPED');
    }
    if (req === null) return this.record(seg, 'SKIPPED');

    for (;;) {
      if (now() >= deadline) return this.record(seg, 'LATE', { latencyMs: Math.round(now() - started) });
      await sleep(pollMs);
      if (gen !== this.generation) return;
      let res: LlmPollResult;
      try {
        res = await client.poll(req.requestId);
      } catch {
        continue; // 일시 오류는 기한까지 다시 묻는다
      }
      if (gen !== this.generation) return;
      if (res.kind === 'pending') continue;
      if (res.kind === 'gone') return this.record(seg, 'FAILED', { latencyMs: Math.round(now() - started) });
      const latencyMs = Math.round(now() - started);
      if (now() > deadline) return this.record(seg, 'LATE', { latencyMs });
      if (this.opts.mode !== 'on') return this.record(seg, 'SHADOW', { title: res.title, sub: res.sub, model: res.model, latencyMs });
      // 띄울지(규칙 지적과의 순서)와 그 기록(SHOWN·LATE)은 받는 쪽(LiveCoach)이 정한다
      try {
        this.opts.onTip({ title: res.title, sub: res.sub, segment: seg.facts.segment.index, model: res.model, latencyMs, expiresInMs: Math.max(0, deadline - now()) });
      } catch {
        this.record(seg, 'FAILED', { latencyMs });
      }
      return;
    }
  }
}
