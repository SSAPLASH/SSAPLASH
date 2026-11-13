import { describe, expect, it } from 'vitest';
import { writeMidiFile, type MidiEvent } from './midiFile';

const HEADER_LEN = 14;
/** 트랙 본문(MTrk 길이 뒤) */
const trackBody = (b: Uint8Array) => Array.from(b.slice(HEADER_LEN + 8));
const write = (events: MidiEvent[], ppq = 480) => writeMidiFile({ ppq, events });
const END = [0x00, 0xff, 0x2f, 0x00];

describe('writeMidiFile', () => {
  it('빈 입력: 헤더와 트랙 끝 메타만', () => {
    const b = write([]);
    expect(Array.from(b)).toEqual([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 4, ...END,
    ]);
  });

  it('트랙 길이는 본문 바이트 수와 같다', () => {
    const b = write([{ kind: 'noteOn', tick: 0, note: 36, velocity: 100 }]);
    const len = (b[18] << 24) | (b[19] << 16) | (b[20] << 8) | b[21];
    expect(len).toBe(b.length - HEADER_LEN - 8);
    expect(len).toBe(1 + 3 + 4); // 델타 1 + 노트 3 + 끝 메타 4
  });

  it('분해능이 헤더에 들어간다', () => {
    const b = write([], 32767);
    expect(Array.from(b.slice(12, 14))).toEqual([0x7f, 0xff]);
  });

  it('이벤트 바이트: 템포·박자표·트랙 이름·노트', () => {
    const body = trackBody(
      write([
        { kind: 'trackName', tick: 0, text: 'Drums' },
        { kind: 'tempo', tick: 0, bpm: 120 },
        { kind: 'timeSignature', tick: 0, numerator: 6, denominator: 8 },
        { kind: 'noteOn', tick: 10, note: 38, velocity: 90 },
        { kind: 'noteOff', tick: 70, note: 38 },
      ]),
    );
    expect(body).toEqual([
      0x00, 0xff, 0x03, 0x05, 0x44, 0x72, 0x75, 0x6d, 0x73,
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
      0x00, 0xff, 0x58, 0x04, 6, 3, 24, 8,
      0x0a, 0x99, 38, 90,
      60, 0x89, 38, 0,
      ...END,
    ]);
  });

  it.each([
    [0, [0x00]],
    [127, [0x7f]],
    [128, [0x81, 0x00]],
    [16383, [0xff, 0x7f]],
    [16384, [0x81, 0x80, 0x00]],
    [0x0fffffff, [0xff, 0xff, 0xff, 0x7f]],
  ])('델타 타임 가변 길이 정수 %i', (tick, bytes) => {
    const body = trackBody(write([{ kind: 'noteOn', tick, note: 36, velocity: 1 }]));
    expect(body).toEqual([...bytes, 0x99, 36, 1, ...END]);
  });

  it('같은 tick 순서: 메타 → noteOff → noteOn (입력 순서와 무관)', () => {
    const body = trackBody(
      write([
        { kind: 'noteOn', tick: 5, note: 36, velocity: 100 },
        { kind: 'noteOff', tick: 5, note: 36 },
        { kind: 'tempo', tick: 5, bpm: 120 },
      ]),
    );
    expect(body).toEqual([
      0x05, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
      0x00, 0x89, 36, 0,
      0x00, 0x99, 36, 100,
      ...END,
    ]);
  });

  it('tick 순으로 정렬하고 같은 종류는 입력 순서를 지킨다', () => {
    const body = trackBody(
      write([
        { kind: 'noteOn', tick: 20, note: 40, velocity: 1 },
        { kind: 'noteOn', tick: 10, note: 41, velocity: 1 },
        { kind: 'noteOn', tick: 10, note: 42, velocity: 1 },
      ]),
    );
    expect(body).toEqual([10, 0x99, 41, 1, 0, 0x99, 42, 1, 10, 0x99, 40, 1, ...END]);
  });

  it('끝 메타 FF 2F 00으로 끝난다', () => {
    const b = write([{ kind: 'noteOff', tick: 3, note: 1 }]);
    expect(Array.from(b.slice(-3))).toEqual([0xff, 0x2f, 0x00]);
  });

  it('잘못된 입력은 예외', () => {
    const on = (tick: number, note: number, velocity = 1): MidiEvent => ({ kind: 'noteOn', tick, note, velocity });
    expect(() => write([], 0)).toThrow();
    expect(() => write([], 32768)).toThrow();
    expect(() => write([], 1.5)).toThrow();
    expect(() => write([on(-1, 36)])).toThrow();
    expect(() => write([on(1.5, 36)])).toThrow();
    expect(() => write([on(0x10000000, 36)])).toThrow();
    expect(() => write([on(0, -1)])).toThrow();
    expect(() => write([on(0, 128)])).toThrow();
    expect(() => write([on(0, 36, 128)])).toThrow();
    expect(() => write([{ kind: 'noteOff', tick: 0, note: 128 }])).toThrow();
    expect(() => write([{ kind: 'tempo', tick: 0, bpm: 0 }])).toThrow();
    expect(() => write([{ kind: 'timeSignature', tick: 0, numerator: 4, denominator: 3 }])).toThrow();
    expect(() => write([{ kind: 'trackName', tick: 0, text: '드럼' }])).toThrow();
  });
});
