// 규칙 평가 결과 중 무엇을 지금 띄울지 정한다. 판정 단계, 전역 간격, 키별 쿨다운, 우선순위, 칭찬.
// 시각은 입력으로 받는다(곡 시각 ms). 시계를 직접 읽지 않는다.
import { coachStage, LIVE_COACH_CONFIG, STAGE1_TAGS, type CoachStage } from './config';
import { RECOVERED_PRAISE, type CoachTarget, type LiveTag, type RuleEvaluation } from './rules';

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

/** 해소된 지적. 경향 해소 칭찬이 무엇이 고쳐졌는지 말하는 데 쓴다 */
export interface RecoveredFrom {
  tag: LiveTag;
  target: CoachTarget | null;
}

export interface PolicyDecision {
  /** 지금 띄울 규칙. 없으면 null */
  show: RuleEvaluation | null;
  /** 이번 호출에서 경향이 사라진(거두는 조건을 만족한) 규칙 */
  recovered: RuleEvaluation[];
  /** show와 같은 태그가 이 플레이에서 앞서 뜬 횟수 */
  repeat: number;
  /** show가 경향 해소 칭찬일 때만: 해소된 지적 중 가장 최근에 띄웠던 것. 그 외에는 null */
  recoveredFrom: RecoveredFrom | null;
  /** 이번 판정의 판정 단계 */
  stage: CoachStage;
}

export class CoachPolicy {
  private states = new Map<string, KeyState>();
  private repeats = new Map<string, number>();
  /** 마지막 문구(지적·칭찬 모두) 시각. 칭찬의 간격 기준이다 */
  private lastShownMs: number | null = null;
  /** 마지막 지적 시각. 지적의 간격 기준이다. 칭찬이 지적을 늦추지 않게 따로 둔다 */
  private lastCorrectionMs: number | null = null;
  private shown = 0;
  /** 경향이 사라졌는데 아직 칭찬하지 못했다(간격이 남았거나, 연주가 아직 안정되지 않았다) */
  private recoveredPending = false;
  /** 칭찬을 기다리는 해소 중 가장 최근에 띄웠던 지적(띄운 시각과 함께) */
  private recoveredLatest: { shownMs: number; from: RecoveredFrom } | null = null;

  reset(): void {
    this.states.clear();
    this.repeats.clear();
    this.lastShownMs = null;
    this.lastCorrectionMs = null;
    this.shown = 0;
    this.recoveredPending = false;
    this.recoveredLatest = null;
  }

  /** 마지막 지적 시각. LLM 구간 문구가 규칙 지적에 끼어들지 않게 쓴다 */
  get lastCorrectionAt(): number | null {
    return this.lastCorrectionMs;
  }

  /** 정책 밖에서 문구를 띄웠다(LLM 구간 문구). 칭찬 간격의 기준만 옮기고 지적 간격은 건드리지 않는다 */
  noteExternalShown(songTimeMs: number): void {
    this.lastShownMs = songTimeMs;
  }

  get shownCount(): number {
    return this.shown;
  }

  /** praise는 지금 연주에 맞는 칭찬 후보. 놓침이 많으면 null이고 그때는 어떤 칭찬도 띄우지 않는다 */
  decide(evals: readonly RuleEvaluation[], ctx: PolicyContext, praise: RuleEvaluation | null = null): PolicyDecision {
    const cfg = LIVE_COACH_CONFIG;

    // 1. 거둘 것을 먼저 거둔다. 시작 억제와 무관하게 항상 처리한다
    const recovered: RuleEvaluation[] = [];
    for (const e of evals) {
      const st = this.states.get(e.key);
      if (st?.active && e.release) {
        st.active = false;
        recovered.push(e);
        if (this.recoveredLatest === null || st.lastShownMs >= this.recoveredLatest.shownMs) {
          this.recoveredLatest = { shownMs: st.lastShownMs, from: { tag: e.tag, target: e.target } };
        }
      }
    }
    if (recovered.length > 0) this.recoveredPending = true;

    // 2. 판정 단계. 0단계는 아무것도 띄우지 않는다
    const stage = coachStage(ctx.judged);
    if (stage === 0) return { show: null, recovered, repeat: 0, recoveredFrom: null, stage };

    // 3. 지적과 지적 사이 간격. 칭찬이 떠 있어도 지적은 바로 그 자리를 차지한다
    if (this.lastCorrectionMs !== null && ctx.songTimeMs - this.lastCorrectionMs < cfg.policy.minGapMs) {
      return { show: null, recovered, repeat: 0, recoveredFrom: null, stage };
    }

    // 4. 띄울 수 있는 후보. 거둔 키는 쿨다운 없이, 아직 활성인 키는 쿨다운이 지나야 다시 띄운다
    // 1단계는 연속 놓침만 띄운다
    const candidates = evals.filter((e) => {
      if (!e.trigger) return false;
      if (stage === 1 && !STAGE1_TAGS.includes(e.tag)) return false;
      const st = this.states.get(e.key);
      if (!st || !st.active) return true;
      return ctx.songTimeMs - st.lastShownMs >= cfg.policy.tagCooldownMs;
    });

    // 5. 우선순위, 같으면 심한 쪽. 지적이 있으면 칭찬은 뜨지 않는다
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.priority - b.priority || b.severity - a.severity);
      const pick = candidates[0];
      this.states.set(pick.key, { active: true, lastShownMs: ctx.songTimeMs });
      this.lastCorrectionMs = ctx.songTimeMs;
      this.recoveredPending = false;
      this.recoveredLatest = null;
      return { show: pick, recovered, repeat: this.markShown(pick, ctx.songTimeMs), recoveredFrom: null, stage };
    }

    // 6. 지적할 것이 없으면 칭찬. 1단계는 칭찬하지 않는다(근거가 적다)
    if (stage === 1) return { show: null, recovered, repeat: 0, recoveredFrom: null, stage };
    const recoveredFrom = this.recoveredLatest?.from ?? null;
    const pick = this.pickPraise(evals, ctx.songTimeMs, praise);
    if (pick === RECOVERED_PRAISE) this.recoveredLatest = null;
    return { show: pick, recovered, repeat: pick ? this.markShown(pick, ctx.songTimeMs) : 0, recoveredFrom: pick === RECOVERED_PRAISE ? recoveredFrom : null, stage };
  }

  private pickPraise(evals: readonly RuleEvaluation[], songTimeMs: number, praise: RuleEvaluation | null): RuleEvaluation | null {
    if (!praise || this.hasPendingCorrection(evals, songTimeMs)) return null;
    const sinceLast = this.lastShownMs === null ? Infinity : songTimeMs - this.lastShownMs;
    // 고쳐졌다는 말은 연주가 안정된 뒤에만 한다. 흔들리는 연주는 거두는 문턱을 우연히 자주 넘기 때문이다
    if (this.recoveredPending && praise.tag === 'LIVE_GOOD_STEADY' && sinceLast >= LIVE_COACH_CONFIG.policy.minGapMs) {
      this.recoveredPending = false;
      return RECOVERED_PRAISE;
    }
    // 일반 칭찬은 더 드물게. 안정 칭찬은 기존 간격 그대로다
    const gap = praise.tag === 'LIVE_GOOD_KEEP' ? LIVE_COACH_CONFIG.praise.keepMinGapMs : LIVE_COACH_CONFIG.praise.minGapMs;
    return sinceLast >= gap ? praise : null;
  }

  /**
   * 고치라고 말해 놓고 곧바로 칭찬하지 않기 위한 확인. 활성 키가 지금도 조건을 만족하거나 쿨다운 안이면 막는다.
   * 쿨다운이 지나고 조건도 벗어난 키는 막지 않는다. 표본이 모자라 거두는 판단을 못 하는 키(창에서 사라진 패드 등)가
   * 플레이 끝까지 칭찬을 막으면 안 되기 때문이다.
   */
  private hasPendingCorrection(evals: readonly RuleEvaluation[], songTimeMs: number): boolean {
    return evals.some((e) => {
      const st = this.states.get(e.key);
      return st?.active === true && (e.trigger || songTimeMs - st.lastShownMs < LIVE_COACH_CONFIG.policy.tagCooldownMs);
    });
  }

  /** 띄운 사실을 기록하고, 같은 태그가 앞서 뜬 횟수를 돌려준다 */
  private markShown(pick: RuleEvaluation, songTimeMs: number): number {
    const repeat = this.repeats.get(pick.tag) ?? 0;
    this.repeats.set(pick.tag, repeat + 1);
    this.lastShownMs = songTimeMs;
    this.shown += 1;
    return repeat;
  }
}
