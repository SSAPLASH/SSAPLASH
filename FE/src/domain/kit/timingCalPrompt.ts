// 박자 맞추기 권유 조건(설계 PLAY-004-timing-cal-stick-kick 4-3). 첫 연주 직전과 건너뛴 뒤 결과 화면에서 한 번씩 권한다.
// 연주 화면(play)과 결과 화면(result)이 함께 쓰므로 공유 domain에 둔다.
import type { TimingCalRecord } from './timingCalibration';

/** none 아직 권하지 않음 / skipped 첫 권유에서 [나중에 하기]·닫기 / done 더 권하지 않음 */
export type TimingCalPrompt = 'none' | 'skipped' | 'done';

export interface TimingCalPromptInput {
  /** 지금 입력이 센서인가(키보드 모드는 권하지 않는다) */
  sensor: boolean;
  timingCal: TimingCalRecord | null;
  prompt: TimingCalPrompt;
}

export function isTimingCalPrompt(v: unknown): v is TimingCalPrompt {
  return v === 'none' || v === 'skipped' || v === 'done';
}

/** 첫 연주 직전에 대화상자를 띄울지: 센서이고, 측정 기록이 없고, 아직 권한 적이 없다 */
export function shouldPromptTimingCal(i: TimingCalPromptInput): boolean {
  return i.sensor && i.timingCal === null && i.prompt === 'none';
}

/** 결과 화면에 권유 띠를 보일지: 센서이고, 측정 기록이 없고, 첫 권유를 건너뛰었다 */
export function shouldRemindTimingCal(i: TimingCalPromptInput): boolean {
  return i.sensor && i.timingCal === null && i.prompt === 'skipped';
}
