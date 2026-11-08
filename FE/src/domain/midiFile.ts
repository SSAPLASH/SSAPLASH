// 표준 MIDI 파일(SMF) Type 0 쓰기 (설계 REC-002 3-2). 패드·녹음·템포 계산을 모르는 순수 함수라 DOM·네트워크에 접근하지 않는다.

export type MidiEvent =
  | { kind: 'tempo'; tick: number; bpm: number }
  | { kind: 'timeSignature'; tick: number; numerator: number; denominator: number }
  | { kind: 'trackName'; tick: number; text: string }
  | { kind: 'noteOn'; tick: number; note: number; velocity: number }
  | { kind: 'noteOff'; tick: number; note: number };

export interface MidiFileInput {
  /** 1~32767 정수 */
  ppq: number;
  events: MidiEvent[];
}

/** 가변 길이 정수가 담을 수 있는 최댓값(4바이트) */
const MAX_VLQ = 0x0fffffff;
/** 채널 10(드럼) 상태 바이트 */
const NOTE_ON = 0x99;
const NOTE_OFF = 0x89;

/** 같은 tick일 때 순서: 메타 → noteOff → noteOn */
function order(e: MidiEvent): number {
  if (e.kind === 'noteOff') return 1;
  if (e.kind === 'noteOn') return 2;
  return 0;
}

function vlq(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > MAX_VLQ) throw new RangeError(`가변 길이 정수 범위 밖: ${value}`);
  const out = [value & 0x7f];
  let v = Math.floor(value / 128);
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  return out;
}

function checkByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 127) throw new RangeError(`${name}은(는) 0~127 정수여야 해요: ${value}`);
}

function body(e: MidiEvent): number[] {
  switch (e.kind) {
    case 'tempo': {
      if (!(e.bpm > 0) || !Number.isFinite(e.bpm)) throw new RangeError(`bpm이 올바르지 않아요: ${e.bpm}`);
      const us = Math.round(60_000_000 / e.bpm);
      if (us < 1 || us > 0xffffff) throw new RangeError(`bpm이 표현 범위 밖이에요: ${e.bpm}`);
      return [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff];
    }
    case 'timeSignature': {
      const { numerator: n, denominator: d } = e;
      if (!Number.isInteger(n) || n < 1 || n > 255) throw new RangeError(`박자표 분자가 올바르지 않아요: ${n}`);
      if (!Number.isInteger(d) || d < 1 || d > 128 || (d & (d - 1)) !== 0) {
        throw new RangeError(`박자표 분모는 2의 거듭제곱이어야 해요: ${d}`);
      }
      return [0xff, 0x58, 0x04, n, Math.log2(d), 24, 8];
    }
    case 'trackName': {
      const bytes = [...e.text].map((c) => c.charCodeAt(0));
      if (bytes.some((b) => b > 0x7f)) throw new RangeError('트랙 이름은 ASCII만 쓸 수 있어요');
      return [0xff, 0x03, ...vlq(bytes.length), ...bytes];
    }
    case 'noteOn':
      checkByte(e.note, '노트 번호');
      checkByte(e.velocity, '세기');
      return [NOTE_ON, e.note, e.velocity];
    case 'noteOff':
      checkByte(e.note, '노트 번호');
      return [NOTE_OFF, e.note, 0];
  }
}

const u32 = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const u16 = (v: number): number[] => [(v >> 8) & 0xff, v & 0xff];

/** SMF Type 0(트랙 1개) 바이트. tick 오름차순 안정 정렬 후 델타 타임으로 쓴다. 잘못된 입력은 RangeError */
export function writeMidiFile(input: MidiFileInput): Uint8Array {
  const { ppq, events } = input;
  if (!Number.isInteger(ppq) || ppq < 1 || ppq > 32767) throw new RangeError(`ppq는 1~32767 정수여야 해요: ${ppq}`);
  for (const e of events) {
    if (!Number.isInteger(e.tick) || e.tick < 0) throw new RangeError(`tick은 0 이상 정수여야 해요: ${e.tick}`);
  }
  // Array.prototype.sort는 안정 정렬이다
  const sorted = [...events].sort((a, b) => a.tick - b.tick || order(a) - order(b));

  const track: number[] = [];
  let prev = 0;
  for (const e of sorted) {
    const data = body(e);
    track.push(...vlq(e.tick - prev), ...data);
    prev = e.tick;
  }
  track.push(...vlq(0), 0xff, 0x2f, 0x00);

  return Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(0), ...u16(1), ...u16(ppq),
    0x4d, 0x54, 0x72, 0x6b, ...u32(track.length), ...track,
  ]);
}
