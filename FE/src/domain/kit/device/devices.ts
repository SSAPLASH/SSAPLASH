// 기기(왼손·오른손 스틱, 페달) 이름과 연결 상태 문구의 단일 출처(UX-device-naming-unify E1~E7).
// 화면은 기기 이름·상태 단어를 따로 적지 않고 여기서 가져온다. 연결 판정은 domain/kit/pedalStatus가 맡는다.

export type DeviceId = 'LEFT' | 'RIGHT' | 'PEDAL';

export interface DeviceMeta {
  /** 문장에 쓰는 이름 */
  name: string;
  /** 셸 칩 글자 */
  chip: string;
  /** 연결 점 글자 */
  mark: string;
}

/** 기기 3개의 이름·칩 글자·점 글자. 순서는 왼손 → 오른손 → 페달 고정 */
export const DEVICE_META: Record<DeviceId, DeviceMeta> = {
  LEFT: { name: '왼손', chip: '왼', mark: 'L' },
  RIGHT: { name: '오른손', chip: '오', mark: 'R' },
  PEDAL: { name: '페달', chip: '페달', mark: 'P' },
};

const ORDER: readonly DeviceId[] = ['LEFT', 'RIGHT', 'PEDAL'];

/** 상태 단어는 이 둘뿐이다(일이 일어난 순간의 제목 「~ 연결이 끊겼어요」만 예외, disconnectTitle) */
export const CONNECTED_TEXT = '연결됨';
export const DISCONNECTED_TEXT = '연결 안 됨';

export interface DeviceStates {
  left: boolean;
  right: boolean;
  /** undefined면 페달을 넣지 않는다(페달이 올 수 없는 소스) */
  pedal?: boolean;
}

/**
 * 기기 상태 한 줄. 모두 붙음: 「왼손·오른손·페달 연결됨」, 일부 빠짐: 「빠진 것만·연결 안 됨」(예: 「오른손·페달 연결 안 됨」).
 * pedal이 undefined면 페달을 넣지 않는다
 */
export function deviceListText(states: DeviceStates): string {
  const on: Record<DeviceId, boolean | undefined> = { LEFT: states.left, RIGHT: states.right, PEDAL: states.pedal };
  const ids = ORDER.filter((id) => on[id] !== undefined);
  const missing = ids.filter((id) => !on[id]);
  if (missing.length === 0) return `${ids.map((id) => DEVICE_META[id].name).join('·')} ${CONNECTED_TEXT}`;
  return `${missing.map((id) => DEVICE_META[id].name).join('·')} ${DISCONNECTED_TEXT}`;
}

/** 묶음 이름: 페달이 필요한 소스면 「스틱·페달」, 아니면 「스틱」 */
export function deviceGroupName(withPedal: boolean): string {
  return withPedal ? '스틱·페달' : '스틱';
}

/**
 * 연주 중 끊긴 순간의 제목(끊김 카드·자유 연습 띠 공용). pedal이 undefined면 페달을 보지 않는다.
 * 페달만 끊김 「페달 연결이 끊겼어요」, 손과 페달 「스틱·페달 연결이 끊겼어요」, 양손 「양손 스틱 연결이 끊겼어요」, 한 손 「왼손 스틱 연결이 끊겼어요」
 */
export function disconnectTitle(left: boolean, right: boolean, pedal?: boolean): string {
  if (pedal === false) return left && right ? '페달 연결이 끊겼어요' : `${deviceGroupName(true)} 연결이 끊겼어요`;
  if (!left && !right) return '양손 스틱 연결이 끊겼어요';
  return `${left ? DEVICE_META.RIGHT.name : DEVICE_META.LEFT.name} 스틱 연결이 끊겼어요`;
}
