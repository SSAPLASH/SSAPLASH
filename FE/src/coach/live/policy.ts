// 규칙 평가 결과 중 무엇을 지금 띄울지 정한다. 시작 억제, 전역 간격, 키별 쿨다운, 플레이당 상한, 우선순위.
// 시각은 입력으로 받는다(곡 시각 ms). 시계를 직접 읽지 않는다.
import { LIVE_COACH_CONFIG } from './config';
import type { RuleEvaluation } from './rules';

interface KeyState {
  /** 띄운 뒤 아직 거두는 조건을 만족하지 않았다 */
  active: boolean;
  lastShownMs: number;
}

export interface PolicyContext {
  songTimeMs: number;
  /** 지금까지 받은 판정 수 */
  judged: number;
}

export interface PolicyDecision {
  /** 지금 띄울 규칙. 없으면 null */
  show: RuleEvaluation | null;
  /** 이번 호출에서 경향이 사라진(거두는 조건을 만족한) 규칙 */
  recovered: RuleEvaluation[];
}

export class CoachPolicy {
  private states = new Map<string, KeyState>();
  private lastShownMs: number | null = null;
  private shown = 0;

  reset(): void {
    this.states.clear();
    this.lastShownMs = null;
    this.shown = 0;
  }

  get shownCount(): number {
    return this.shown;
  }

  decide(evals: readonly RuleEvaluation[], ctx: PolicyContext): PolicyDecision {
    const cfg = LIVE_COACH_CONFIG;

    // 1. 거둘 것을 먼저 거둔다. 시작 억제·상한과 무관하게 항상 처리한다
    const recovered: RuleEvaluation[] = [];
    for (const e of evals) {
      const st = this.states.get(e.key);
      if (st?.active && e.release) {
        st.active = false;
        recovered.push(e);
      }
    }

    // 2. 전역 제한
    if (ctx.judged < cfg.warmupJudgements) return { show: null, recovered };
    if (this.shown >= cfg.policy.maxPerPlay) return { show: null, recovered };
    if (this.lastShownMs !== null && ctx.songTimeMs - this.lastShownMs < cfg.policy.minGapMs) {
      return { show: null, recovered };
    }

    // 3. 띄울 수 있는 후보. 거둔 키는 쿨다운 없이, 아직 활성인 키는 쿨다운이 지나야 다시 띄운다
    const candidates = evals.filter((e) => {
      if (!e.trigger) return false;
      const st = this.states.get(e.key);
      if (!st || !st.active) return true;
      return ctx.songTimeMs - st.lastShownMs >= cfg.policy.tagCooldownMs;
    });
    if (candidates.length === 0) return { show: null, recovered };

    // 4. 우선순위, 같으면 심한 쪽
    candidates.sort((a, b) => a.priority - b.priority || b.severity - a.severity);
    const pick = candidates[0];
    this.states.set(pick.key, { active: true, lastShownMs: ctx.songTimeMs });
    this.lastShownMs = ctx.songTimeMs;
    this.shown += 1;
    return { show: pick, recovered };
  }
}
