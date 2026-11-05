// 실시간 코칭(COACH-001) 규칙 모듈의 공개 진입점. 화면·엔진은 여기서만 가져온다.
export { LiveCoach, LIVE_OFF_TAG, LIVE_RECOVERED_TAG } from './LiveCoach';
export type { CoachMessage, LiveCoachLogEntry, LiveCoachOptions } from './LiveCoach';
export type { JudgedNote } from './window';
export { isPraiseTag } from './rules';
export type { CoachTarget, LiveTag } from './rules';
export { coachCopy } from './copy';
export type { CoachCopy } from './copy';
export { LIVE_COACH_CONFIG } from './config';
