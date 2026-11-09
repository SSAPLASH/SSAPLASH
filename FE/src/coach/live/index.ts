// 실시간 코칭(COACH-001) 규칙 모듈의 공개 진입점. 화면·엔진은 여기서만 가져온다.
export { LiveCoach, LIVE_GATE_DROP_TAG, LIVE_GATE_FALLBACK_TAG, LIVE_GATE_KEEP_TAG, LIVE_OFF_TAG, LIVE_RECOVERED_TAG } from './LiveCoach';
export type { CoachMessage, DeferredMessage, LiveCoachLogEntry, LiveCoachOptions } from './LiveCoach';
export type { GateDecision } from './gate/gate';
export type { JudgedNote } from './window';
export { isPraiseTag } from './rules';
export type { CoachTarget, LiveTag } from './rules';
export { isStickSensor, setupTagsOf } from './setupHints';
export { coachCopy } from './copy';
export type { CoachCopy } from './copy';
export { LIVE_COACH_CONFIG } from './config';
