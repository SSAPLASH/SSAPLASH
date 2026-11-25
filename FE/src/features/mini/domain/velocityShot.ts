// 세기를 겨루는 미니게임이 같이 쓰는 계산 (설계 MODE-006-minigame-crescendo D12). 「강약중강약」과 「어디까지 올라가는 거예요?」가 쓴다.
// 받을 타격인지·다른 패드인지·받은 타격의 세기 모으기·눈금 자리·시작할 수 있는지. 게임별 규칙(목표·계단·점수)은 각 게임의 파일에 둔다.
// 세기 눈금은 스틱이 내는 1~127이다(위키 EMB 「타격 감지와 패드 판정」 3장). 시계는 읽지 않는다.
import { isSensorSource, type ResolvedHit, type SensorId } from '@/domain/events';
import { stickConnectionRequired } from '@/domain/kit/device/dockChip';
import type { PadId } from '@/domain/kit/pads';
import { hitTime } from './hitTime';

/** 눈금 양 끝 */
export const VELOCITY_MIN = 1;
export const VELOCITY_MAX = 127;
/** 받는 패드. 패드마다 스윙 높이가 달라 같은 힘에도 세기가 달라지므로 스네어 하나만 받는다 */
export const VELOCITY_PAD: PadId = 'SNARE';
/** 받은 타격 뒤(그리고 단계가 시작된 직후) 다음 타격을 받지 않는 시간. 한 번 친 것이 두 타로 들어가는 것을 막는다 */
export const SHOT_GUARD_MS = 300;
/** 「스네어를 쳐 주세요」를 보이는 시간 */
export const WRONG_PAD_HINT_MS = 1500;

/** 받을지 가리는 데 쓰는 타격의 필드 */
export type ShotHit = Pick<ResolvedHit, 'pad' | 'source' | 'tHit' | 'tRecv'>;
/** 세기까지 읽는 타격 */
export type VelocityHit = ShotHit & Pick<ResolvedHit, 'velocity'>;

/** 세기를 눈금(1~127) 안의 정수로 맞춘다 */
export function toVelocity(velocity: number): number {
  return Math.min(VELOCITY_MAX, Math.max(VELOCITY_MIN, Math.round(velocity)));
}

/**
 * 타수로 받을 타격인가. 센서 소스의 스네어 타격이고 기준 시각(단계 시작 시각 또는 직전에 받은 타격의 시각)에서 보호 시간이 지났어야 한다.
 * 키보드·화면 터치는 세기가 고정이라 받지 않고, 패드를 판정하지 못한 타격(세게 친 뒤 튀어 오르며 생기는 약한 타격)도 여기서 걸러진다
 */
export function acceptsShot(hit: ShotHit, since: number): boolean {
  if (!isSensorSource(hit.source) || hit.pad !== VELOCITY_PAD) return false;
  return hitTime(hit) - since >= SHOT_GUARD_MS;
}

/** 센서 소스 타격인데 스네어가 아닌 다른 패드를 쳤는가. 패드 판정이 없는 타격은 거짓이다(안내하지 않는다) */
export function isWrongPad(hit: Pick<ResolvedHit, 'pad' | 'source'>): boolean {
  return isSensorSource(hit.source) && hit.pad !== null && hit.pad !== VELOCITY_PAD;
}

/**
 * 받은 타격(받은 순서)에서 타수로 받을 것의 세기만 `limit`개까지 고른다. `limit`을 넘기지 않으면 끝까지 고른다.
 * 기준 시각은 단계 시작 시각에서 출발해 받은 타격의 시각으로 옮겨 간다. 단계 시작보다 이른 타격은 보호 시간에 걸려 빠진다.
 * 받은 순서대로 보므로 늦게 도착한 타격 때문에 이미 보인 결과가 바뀌지 않는다
 */
export function collectVelocities(since: number, hits: readonly VelocityHit[], limit = Number.POSITIVE_INFINITY): number[] {
  const out: number[] = [];
  let from = since;
  for (const hit of hits) {
    if (out.length >= limit) break;
    if (!acceptsShot(hit, from)) continue;
    out.push(toVelocity(hit.velocity));
    from = hitTime(hit);
  }
  return out;
}

/** 눈금 위 자리 0~1 (1이 0, 127이 1) */
export function velocityRatio(velocity: number): number {
  const ratio = (velocity - VELOCITY_MIN) / (VELOCITY_MAX - VELOCITY_MIN);
  return Math.min(1, Math.max(0, ratio));
}

/**
 * 세기를 재는 입력이 준비됐는가. 자유 연습·상단 연결 표시와 같은 판정이다.
 * 센서를 고르지 않았으면(키보드 전용) 거짓, 연결 개념이 없는 센서 소스(포인터 모의 스틱)는 참, 연결이 필요한 소스(동글·BLE)는 한 손 이상 연결돼야 참
 */
export function canStartVelocityGame(sensorKind: SensorId, hasUsageGuide: boolean, connected: readonly [boolean, boolean]): boolean {
  if (sensorKind === 'none') return false;
  if (!stickConnectionRequired(sensorKind, hasUsageGuide)) return true;
  return connected[0] || connected[1];
}
