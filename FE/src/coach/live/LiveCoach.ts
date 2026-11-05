// 실시간 코칭 진입점. 판정 한 건마다 push를 부르면 문구를 띄울 때만 돌려준다.
// 창(window) → 규칙(rules) → 정책(policy)을 묶고, 플레이 로그에 넣을 liveCoachEvents를 쌓는다.
// DOM·저장소·시계를 쓰지 않는다. 시각은 입력(곡 시각 ms)으로 받는다.
// 코칭 계산이 플레이를 막으면 안 되므로 push는 예외를 던지지 않는다.
import { type CoachBasis, coachThresholds, LIVE_COACH_CONFIG, type LiveThresholds } from './config';
import { CoachPolicy } from './policy';
import { evaluateRules, type CoachTarget, type LiveTag } from './rules';
import { JudgedWindow, type JudgedNote } from './window';

export interface LiveCoachOptions {
  /** 이 플레이에 적용된 판정 폭 goodMs(ms) */
  goodMs: number;
  /** false면 문구를 띄우지 않고 로그에 LIVE_OFF 한 건만 남긴다(대조군 구분용). 기본 true */
  enabled?: boolean;
  /** 임계값 기준 방식. 생략하면 config의 COACH_BASIS(기본 fixed) */
  basis?: CoachBasis;
}

export interface CoachMessage {
  tag: LiveTag;
  text: string;
  /** 0~1 */
  severity: number;
  /** 문구가 결정된 곡 시각(ms) */
  tMs: number;
  /** 권장 표시 시간(ms) */
  displayMs: number;
  /** 패드·손 규칙의 대상. 그 외 태그는 null */
  target: CoachTarget | null;
}

/** 플레이 로그 liveCoachEvents[] 한 항목. BE 검증: tMs 유한 수, tag ≤ 64자, text ≤ 2048자, 최대 1,000개 */
export interface LiveCoachLogEntry {
  tMs: number;
  tag: string;
  text: string;
}

/** 경향이 사라졌을 때 로그에만 남기는 태그(화면에 띄우지 않는다) */
export const LIVE_RECOVERED_TAG = 'LIVE_RECOVERED';
export const LIVE_OFF_TAG = 'LIVE_OFF';
/** BE 검증 상한(PlayUploadValidator) */
const MAX_LOG = 1_000;

export class LiveCoach {
  private readonly enabled: boolean;
  private thresholds: LiveThresholds;
  private readonly window = new JudgedWindow();
  private readonly policy = new CoachPolicy();
  private log: LiveCoachLogEntry[] = [];

  constructor(opts: LiveCoachOptions) {
    this.enabled = opts.enabled ?? true;
    this.thresholds = coachThresholds(opts.goodMs, opts.basis);
    this.resetLog();
  }

  /** 판정 한 건을 넣는다. 문구를 띄울 때만 돌려주고 아니면 null. 일시정지 중에는 부르지 않는다 */
  push(note: JudgedNote): CoachMessage | null {
    if (!this.enabled) return null;
    try {
      if (!Number.isFinite(note.songTimeMs)) return null;
      this.window.push(note);
      const evals = evaluateRules(this.window.metrics(), this.thresholds);
      const { show, recovered } = this.policy.decide(evals, { songTimeMs: note.songTimeMs, judged: this.window.total });

      for (const r of recovered) this.append(note.songTimeMs, LIVE_RECOVERED_TAG, `경향 해소: ${r.key}`);
      if (!show) return null;

      this.append(note.songTimeMs, show.tag, show.text);
      return { tag: show.tag, text: show.text, severity: show.severity, tMs: note.songTimeMs, displayMs: LIVE_COACH_CONFIG.policy.displayMs, target: show.target };
    } catch {
      // 코칭 오류로 플레이를 멈추지 않는다. 이 판정은 건너뛰고 다음 판정부터 다시 계산한다
      return null;
    }
  }

  /** 지금까지 띄운 문구와 경향 해소 기록. 업로드 본문의 liveCoachEvents에 담는다 */
  events(): readonly LiveCoachLogEntry[] {
    return this.log;
  }

  /** 재시작(다시 하기)에서 상태와 로그를 모두 비운다 */
  reset(): void {
    this.window.reset();
    this.policy.reset();
    this.resetLog();
  }

  private resetLog(): void {
    this.log = this.enabled ? [] : [{ tMs: 0, tag: LIVE_OFF_TAG, text: '코칭 꺼짐' }];
  }

  private append(tMs: number, tag: string, text: string): void {
    if (this.log.length >= MAX_LOG) return;
    this.log.push({ tMs, tag, text });
  }
}
