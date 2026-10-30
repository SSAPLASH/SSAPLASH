// 스틱별 연결·배터리를 화면 표시용 값으로 바꾸는 순수 함수. 스토어는 호출자가 읽는다.
export const BATTERY_LOW_PCT = 20;

export interface StickStatusView {
  /** 점 색: on 초록(연결) / off 빨강(끊김) */
  dot: 'on' | 'off';
  /** ok 정상 / low 부족(≤20%) / unknown 알 수 없음 */
  battery: 'ok' | 'low' | 'unknown';
  /** "82%" 또는 "–". 끊겨도 마지막 값을 그대로 둔다(흐림은 UI가 dot로 판단) */
  batteryText: string;
  /** 칩용 한 글자 */
  label: '왼' | '오';
  handName: '왼손' | '오른손';
  /** 한 줄 문구. 예: "왼손 연결됨 · 82%" */
  text: string;
}

/** hand: 0 왼손, 1 오른손 */
export function stickStatus(connected: boolean, batteryPct: number | null, hand: 0 | 1): StickStatusView {
  const known = batteryPct !== null && Number.isFinite(batteryPct);
  const pct = known ? Math.round(Math.min(100, Math.max(0, batteryPct))) : null;
  const battery: StickStatusView['battery'] = pct === null ? 'unknown' : pct <= BATTERY_LOW_PCT ? 'low' : 'ok';
  const batteryText = pct === null ? '–' : `${pct}%`;
  const handName = hand === 0 ? '왼손' : '오른손';
  return {
    dot: connected ? 'on' : 'off',
    battery,
    batteryText,
    label: hand === 0 ? '왼' : '오',
    handName,
    text: `${handName} ${connected ? '연결됨' : '연결 안 됨'} · ${batteryText}`,
  };
}
