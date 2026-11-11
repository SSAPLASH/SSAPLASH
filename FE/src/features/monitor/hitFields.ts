// HIT 20바이트 패킷의 필드 경계표와 hex 묶음 함수. 화면 로직과 분리한 순수 계산이다.
// 바이트 배치는 stickProtocol.decodePacket의 HIT 분기와 같다([0]type … [19]decel).

export type HitFieldKey =
  | 'type'
  | 'flags'
  | 'seq'
  | 'ts'
  | 'pad'
  | 'margin'
  | 'elev'
  | 'azim'
  | 'peak'
  | 'vel'
  | 'swing'
  | 'lat'
  | 'decel';

export interface HitFieldDef {
  key: HitFieldKey;
  label: string;
  /** 시작 바이트(포함) */
  start: number;
  /** 끝 바이트(미포함) */
  end: number;
}

export const HIT_FIELDS: readonly HitFieldDef[] = [
  { key: 'type', label: 'type', start: 0, end: 1 },
  { key: 'flags', label: 'flags', start: 1, end: 2 },
  { key: 'seq', label: 'seq', start: 2, end: 3 },
  { key: 'ts', label: 'timestampUs', start: 3, end: 7 },
  { key: 'pad', label: 'pad', start: 7, end: 8 },
  { key: 'margin', label: 'margin', start: 8, end: 9 },
  { key: 'elev', label: 'elev', start: 9, end: 11 },
  { key: 'azim', label: 'azim', start: 11, end: 13 },
  { key: 'peak', label: 'peakSpeed', start: 13, end: 15 },
  { key: 'vel', label: 'velocity', start: 15, end: 16 },
  { key: 'swing', label: 'swingMs', start: 16, end: 17 },
  { key: 'lat', label: 'lateral', start: 17, end: 19 },
  { key: 'decel', label: 'decel', start: 19, end: 20 },
];

export interface HexGroup {
  key: HitFieldKey;
  start: number;
  end: number;
  /** 대문자 2자리 hex를 공백으로 이은 문자열 */
  hex: string;
}

const hex2 = (b: number): string => b.toString(16).padStart(2, '0').toUpperCase();

/** 바이트를 필드 경계로 묶는다. 20바이트보다 짧으면 가진 만큼만 묶고, 길면 넘는 바이트는 무시한다 */
export function hexGroups(bytes: Uint8Array): HexGroup[] {
  const out: HexGroup[] = [];
  for (const f of HIT_FIELDS) {
    if (f.start >= bytes.length) break;
    const end = Math.min(f.end, bytes.length);
    out.push({
      key: f.key,
      start: f.start,
      end,
      hex: Array.from(bytes.subarray(f.start, end), hex2).join(' '),
    });
  }
  return out;
}

/** 임의 바이트열을 공백 2자리 hex로 */
export function hexSpaced(bytes: Uint8Array): string {
  return Array.from(bytes, hex2).join(' ');
}
