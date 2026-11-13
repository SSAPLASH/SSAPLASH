// 코칭 기준 두 방식 비교용 그림자 평가(MODE-001 설계 D6, 진단 빌드 전용).
// 같은 판정 입력을 fixed·window 두 LiveCoach에 똑같이 넣고, 각 방식이 문구를 낼 때마다 publish로 알린다.
// 화면에는 아무것도 띄우지 않는다. 호출부(PlayPage)가 VITE_MONITOR 빌드에서만 동적 import로 불러온다.
import { type CoachBasis } from '@/coach/live/config';
import { LiveCoach } from '@/coach/live/LiveCoach';
import { isPraiseTag } from '@/coach/live/rules';
import type { JudgedNote } from '@/coach/live/window';

/** 진단 이벤트 coachEval의 본문(type 제외) */
export interface CoachEvalBody {
  basis: CoachBasis;
  /** 실제 화면 코칭이 쓰는 방식이면 true */
  active: boolean;
  tag: string;
  /** 문구가 결정된 곡 시각(ms) */
  tMs: number;
}

export interface CoachShadowOptions {
  /** 이 플레이의 사용자 판정 폭 */
  goodMs: number;
  /** 화면 코칭이 쓰는 방식(COACH_BASIS) */
  activeBasis: CoachBasis;
  publish: (body: CoachEvalBody) => void;
}

export interface CoachShadow {
  push(note: JudgedNote): void;
  reset(): void;
}

const BASES: readonly CoachBasis[] = ['fixed', 'window'];

export function createCoachShadow(opts: CoachShadowOptions): CoachShadow {
  // 화면 코치의 enabled 설정과 무관하게 두 방식 모두 문구를 내야 비교가 된다
  const coaches = BASES.map((basis) => ({ basis, coach: new LiveCoach({ goodMs: opts.goodMs, basis, enabled: true, gate: null }) }));
  return {
    push(note) {
      for (const { basis, coach } of coaches) {
        try {
          const m = coach.push(note);
          // 칭찬은 두 방식의 지적을 비교하는 데 쓰지 않는다
          if (m && !isPraiseTag(m.tag)) opts.publish({ basis, active: basis === opts.activeBasis, tag: m.tag, tMs: m.tMs });
        } catch {
          // 그림자 평가 오류로 플레이를 막지 않는다
        }
      }
    },
    reset() {
      for (const { coach } of coaches) coach.reset();
    },
  };
}
