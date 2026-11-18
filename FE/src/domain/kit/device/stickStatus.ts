// 스틱별 연결·배터리를 화면 표시용 값으로 바꾸는 순수 함수. 스토어는 호출자가 읽는다.
// 배터리 기준(EMB 회신 Q4): 20% 이하 부족(주황), 10% 이하 곧 꺼짐(빨강). 펌웨어는 3.3V 아래 15초면 스스로 꺼진다.
import { CONNECTED_TEXT, DEVICE_META, DISCONNECTED_TEXT } from './devices';

export const BATTERY_LOW_PCT = 20;
export const BATTERY_CRITICAL_PCT = 10;
/** 표시 배터리는 최근 이만큼(5초 간격 STATUS) 평균. 연주 중 전류로 ±3% 흔들리는 걸 누른다 */
export const BATTERY_SMOOTH_COUNT = 3;

/** 새 배터리 측정값을 이력에 더하고 표시값(평균, 반올림)을 낸다. 이력은 최근 BATTERY_SMOOTH_COUNT개만 남긴다 */
export function smoothBattery(history: readonly number[], next: number): { history: number[]; value: number } {
  const h = [...history, next].slice(-BATTERY_SMOOTH_COUNT);
  return { history: h, value: Math.round(h.reduce((a, b) => a + b, 0) / h.length) };
}

export interface StickStatusView {
  /** 점 색: on 초록(연결) / off 빨강(연결 안 됨) */
  dot: 'on' | 'off';
  /** ok 정상 / low 부족(≤20%) / critical 곧 꺼짐(≤10%) / unknown 알 수 없음 */
  battery: 'ok' | 'low' | 'critical' | 'unknown';
  /** "82%" 또는 "–". 끊겨도 마지막 값을 그대로 둔다(흐림은 UI가 dot로 판단) */
  batteryText: string;
  /** 칩용 한 글자 */
  label: string;
  handName: string;
  /** 한 줄 문구. 예: "왼손 연결됨 · 82%" */
  text: string;
}

/** hand: 0 왼손, 1 오른손 */
export function stickStatus(connected: boolean, batteryPct: number | null, hand: 0 | 1): StickStatusView {
  const known = batteryPct !== null && Number.isFinite(batteryPct);
  const pct = known ? Math.round(Math.min(100, Math.max(0, batteryPct))) : null;
  const battery: StickStatusView['battery'] =
    pct === null ? 'unknown' : pct <= BATTERY_CRITICAL_PCT ? 'critical' : pct <= BATTERY_LOW_PCT ? 'low' : 'ok';
  const batteryText = pct === null ? '–' : `${pct}%`;
  const meta = hand === 0 ? DEVICE_META.LEFT : DEVICE_META.RIGHT;
  const handName = meta.name;
  return {
    dot: connected ? 'on' : 'off',
    battery,
    batteryText,
    label: meta.chip,
    handName,
    text: `${handName} ${connected ? CONNECTED_TEXT : DISCONNECTED_TEXT} · ${batteryText}`,
  };
}
