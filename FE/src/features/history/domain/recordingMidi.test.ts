import { describe, expect, it } from 'vitest';
import { ALL_PADS } from '@/domain/kit/pads';
import type { RecordingDetail, RecordingHit, RecordingTiming } from '@/domain/play/recording';
import {
  MIDI_FALLBACK_BPM,
  MIDI_FALLBACK_PPQ,
  PAD_GM_NOTE,
  midiFileName,
  recordingMidiEvents,
  recordingToMidi,
} from './recordingMidi';

const timing = (over: Partial<RecordingTiming> = {}): RecordingTiming => ({
  songId: 1,
  chartVersionId: 1,
  bpm: 120,
  offsetMs: 1000,
  timeSignature: '4/4',
  ppq: 480,
  tempoMap: [{ tick: 0, bpm: 120 }],
  timeSignatureMap: [{ tick: 0, numerator: 4, denominator: 4 }],
  ...over,
});

const detail = (hits: RecordingHit[], t: RecordingTiming | null = null): RecordingDetail => ({
  id: 5,
  clientKey: 'k',
  title: '연습',
  mode: t ? 'RHYTHM' : 'FREE',
  inputSource: 'KEYBOARD',
  playId: null,
  hitCount: hits.length,
  durationMs: 10_000,
  startedAt: '2026-11-07T00:00:00Z',
  createdAt: '2026-11-07T00:00:00Z',
  updatedAt: '2026-11-07T00:00:00Z',
  song: null,
  timing: t,
  hits,
});

const hit = (tMs: number, pad: RecordingHit['pad'] = 'KICK', velocity = 100): RecordingHit => ({ tMs, pad, velocity });
const events = (d: RecordingDetail) => recordingMidiEvents(d).events;
const ofKind = <K extends string>(d: RecordingDetail, kind: K) =>
  events(d).filter((e) => e.kind === kind) as Extract<ReturnType<typeof events>[number], { kind: K }>[];

describe('PAD_GM_NOTE', () => {
  it('설계 3-3 표와 같고 모든 패드가 있다', () => {
    expect(PAD_GM_NOTE).toEqual({
      KICK: 36,
      SNARE: 38,
      HIHAT: 42,
      HIHAT_PEDAL: 44,
      SMALL_TOM: 50,
      MID_TOM: 47,
      FLOOR_TOM: 43,
      CRASH: 49,
      RIDE: 51,
    });
    expect(Object.keys(PAD_GM_NOTE).sort()).toEqual([...ALL_PADS].sort());
  });
});

describe('템포 해석', () => {
  const fallbackOf = (d: RecordingDetail) => {
    const r = recordingMidiEvents(d);
    expect(r.ppq).toBe(MIDI_FALLBACK_PPQ);
    expect(ofKind(d, 'tempo')).toEqual([{ kind: 'tempo', tick: 0, bpm: MIDI_FALLBACK_BPM }]);
    expect(ofKind(d, 'timeSignature')).toEqual([{ kind: 'timeSignature', tick: 0, numerator: 4, denominator: 4 }]);
    expect(recordingToMidi(d).usedChartTiming).toBe(false);
  };

  it('timing null: 120 BPM, 4/4, ppq 480, 원점 0ms (1000ms → 960 tick)', () => {
    const d = detail([hit(1000)]);
    fallbackOf(d);
    expect(ofKind(d, 'noteOn')[0].tick).toBe(960);
  });

  it('유효한 timing: 채보 템포·박자표·ppq를 그대로 쓴다', () => {
    const d = detail(
      [hit(1000)],
      timing({
        ppq: 96,
        tempoMap: [
          { tick: 0, bpm: 100 },
          { tick: 384, bpm: 150 },
        ],
        timeSignatureMap: [
          { tick: 0, numerator: 3, denominator: 4 },
          { tick: 384, numerator: 6, denominator: 8 },
        ],
      }),
    );
    expect(recordingMidiEvents(d).ppq).toBe(96);
    expect(ofKind(d, 'tempo').map((e) => [e.tick, e.bpm])).toEqual([
      [0, 100],
      [384, 150],
    ]);
    expect(ofKind(d, 'timeSignature').map((e) => [e.tick, e.numerator, e.denominator])).toEqual([
      [0, 3, 4],
      [384, 6, 8],
    ]);
    expect(recordingToMidi(d).usedChartTiming).toBe(true);
    expect(ofKind(d, 'trackName')).toEqual([{ kind: 'trackName', tick: 0, text: 'Drums' }]);
  });

  it.each([
    ['ppq 0', { ppq: 0 }],
    ['ppq 소수', { ppq: 96.5 }],
    ['ppq 범위 초과', { ppq: 40000 }],
    ['tempoMap 첫 tick ≠ 0', { tempoMap: [{ tick: 10, bpm: 120 }] }],
    ['tempoMap bpm 0', { tempoMap: [{ tick: 0, bpm: 0 }] }],
    [
      'tempoMap tick 비증가',
      {
        tempoMap: [
          { tick: 0, bpm: 120 },
          { tick: 0, bpm: 130 },
        ],
      },
    ],
    ['tempoMap 비었고 bpm 무효', { tempoMap: [], bpm: 0 }],
  ])('무효 timing(%s)이면 대체값', (_name, over) => {
    fallbackOf(detail([hit(0)], timing(over)));
  });

  it('tempoMap이 비었고 bpm·ppq가 유효하면 [{tick 0, bpm}]', () => {
    const d = detail([hit(1000)], timing({ tempoMap: [], bpm: 90 }));
    expect(ofKind(d, 'tempo')).toEqual([{ kind: 'tempo', tick: 0, bpm: 90 }]);
    expect(recordingToMidi(d).usedChartTiming).toBe(true);
  });

  it('timeSignatureMap이 비면 4/4', () => {
    const d = detail([hit(1000)], timing({ timeSignatureMap: [] }));
    expect(ofKind(d, 'timeSignature')).toEqual([{ kind: 'timeSignature', tick: 0, numerator: 4, denominator: 4 }]);
  });

  it('분모가 2의 거듭제곱이 아니면 박자표만 4/4, 템포는 유지', () => {
    const d = detail(
      [hit(1000)],
      timing({
        tempoMap: [{ tick: 0, bpm: 90 }],
        timeSignatureMap: [{ tick: 0, numerator: 5, denominator: 3 }],
      }),
    );
    expect(ofKind(d, 'timeSignature')).toEqual([{ kind: 'timeSignature', tick: 0, numerator: 4, denominator: 4 }]);
    expect(ofKind(d, 'tempo')).toEqual([{ kind: 'tempo', tick: 0, bpm: 90 }]);
  });
});

describe('ms → tick', () => {
  it('단일 템포: offsetMs가 tick 0, 120 BPM·ppq 480이면 500ms = 480 tick', () => {
    const d = detail([hit(1000), hit(1500), hit(2000)], timing());
    expect(ofKind(d, 'noteOn').map((e) => e.tick)).toEqual([0, 480, 960]);
  });

  it('템포 변화 구간: 120 BPM 1박(500ms) 뒤 60 BPM으로 바뀐다', () => {
    const t = timing({
      offsetMs: 0,
      tempoMap: [
        { tick: 0, bpm: 120 },
        { tick: 480, bpm: 60 },
      ],
    });
    // 500ms = 480 tick, 이후 1박 = 1000ms
    const d = detail([hit(250), hit(500), hit(1000), hit(1500)], t);
    expect(ofKind(d, 'noteOn').map((e) => e.tick)).toEqual([240, 480, 720, 960]);
  });

  it('원점 앞 타격: 앞 마디가 붙고 모든 이벤트가 밀린다', () => {
    // 500ms 앞 = -480 tick, 1마디 = 1920 tick → K = 1
    const d = detail([hit(500, 'SNARE'), hit(1000), hit(2000)], timing({ tempoMap: [{ tick: 0, bpm: 120 }] }));
    const ons = ofKind(d, 'noteOn');
    expect(ons.map((e) => [e.note, e.tick])).toEqual([
      [38, 1920 - 480],
      [36, 1920],
      [36, 1920 + 960],
    ]);
    // 첫 박자표·첫 템포를 tick 0에도 둔다
    expect(ofKind(d, 'timeSignature').map((e) => e.tick)).toEqual([0, 1920]);
    expect(ofKind(d, 'tempo').map((e) => e.tick)).toEqual([0, 1920]);
  });

  it('앞 마디 수는 첫 박자표 마디 길이 기준(3/4 = 1440 tick), 필요하면 2마디', () => {
    const t = timing({ timeSignatureMap: [{ tick: 0, numerator: 3, denominator: 4 }] });
    // -2000 tick 상당: 120BPM에서 -2083.3ms → 1440 × 2 = 2880 ≥ 2000
    const d = detail([hit(1000 - (2000 * 500) / 480)], t);
    expect(ofKind(d, 'noteOn')[0].tick).toBe(2880 - 2000);
    expect(ofKind(d, 'timeSignature').map((e) => e.tick)).toEqual([0, 2880]);
  });

  it('원점 앞 타격이 없으면 앞 마디가 없다', () => {
    const d = detail([hit(1000)], timing());
    expect(ofKind(d, 'timeSignature').map((e) => e.tick)).toEqual([0]);
  });

  it('원점 앞은 첫 구간 bpm으로 거꾸로 센다', () => {
    const t = timing({
      offsetMs: 1000,
      tempoMap: [
        { tick: 0, bpm: 60 },
        { tick: 480, bpm: 240 },
      ],
    });
    // 60 BPM: 1000ms = 480 tick. -500ms = -240 tick, 1마디 1920 → shift 1920
    const d = detail([hit(500)], t);
    expect(ofKind(d, 'noteOn')[0].tick).toBe(1920 - 240);
  });
});

describe('노트 길이·세기', () => {
  it('기본 길이는 ppq / 8 (480이면 60 tick)', () => {
    const d = detail([hit(0)]);
    const [on] = ofKind(d, 'noteOn');
    const [off] = ofKind(d, 'noteOff');
    expect(off.tick - on.tick).toBe(60);
    expect(off.note).toBe(on.note);
  });

  it('같은 노트를 가깝게 치면 noteOff ≤ 다음 noteOn, 길이는 최소 1', () => {
    // tick 0, 30, 31 (480 ppq, 120 BPM → 1 tick ≈ 1.0417ms)
    const ms = (tick: number) => (tick * 500) / 480;
    const d = detail([hit(ms(0)), hit(ms(30)), hit(ms(31))]);
    const ons = ofKind(d, 'noteOn').map((e) => e.tick);
    const offs = ofKind(d, 'noteOff').map((e) => e.tick);
    expect(ons).toEqual([0, 30, 31]);
    expect(offs).toEqual([29, 31, 91]); // 간격 1이면 길이 1(같은 tick에서 noteOff가 먼저 정렬된다)
    for (let i = 0; i < ons.length - 1; i++) expect(offs[i]).toBeLessThanOrEqual(ons[i + 1]);
  });

  it('다른 노트끼리는 서로 길이에 영향이 없다', () => {
    const d = detail([hit(0, 'KICK'), hit(1, 'SNARE')]);
    const offs = ofKind(d, 'noteOff');
    expect(offs.map((e) => e.tick).sort((a, b) => a - b)).toEqual([60, 61]);
  });

  it('같은 tick의 같은 노트는 하나로 합친다(세기는 큰 쪽)', () => {
    const d = detail([hit(0, 'KICK', 50), hit(0.1, 'KICK', 90)]);
    const ons = ofKind(d, 'noteOn');
    expect(ons).toHaveLength(1);
    expect(ons[0].velocity).toBe(90);
    expect(ofKind(d, 'noteOff')).toHaveLength(1);
  });

  it('세기 0은 1, 범위 밖은 1~127로 자르고 반올림한다', () => {
    const d = detail([hit(0, 'KICK', 0), hit(100, 'SNARE', 1), hit(200, 'HIHAT', 127.4), hit(300, 'CRASH', 300), hit(400, 'RIDE', 64.6)]);
    expect(ofKind(d, 'noteOn').map((e) => e.velocity)).toEqual([1, 1, 127, 127, 65]);
  });

  it('노트 수 = 타격 수 × 2 (겹치지 않는 경우)', () => {
    const d = detail([hit(0), hit(500, 'SNARE'), hit(1000, 'HIHAT')]);
    const notes = events(d).filter((e) => e.kind === 'noteOn' || e.kind === 'noteOff');
    expect(notes).toHaveLength(6);
  });
});

describe('recordingToMidi', () => {
  it('SMF 헤더·분해능·끝 메타를 갖춘 바이트를 만든다', () => {
    const { bytes } = recordingToMidi(detail([hit(0)]));
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x4d, 0x54, 0x68, 0x64]);
    expect(Array.from(bytes.slice(8, 14))).toEqual([0, 0, 0, 1, 0x01, 0xe0]);
    expect(Array.from(bytes.slice(-3))).toEqual([0xff, 0x2f, 0x00]);
  });

  it('타격이 없어도 만들어진다', () => {
    expect(recordingToMidi(detail([])).bytes.length).toBeGreaterThan(14);
  });
});

describe('midiFileName', () => {
  it('제목에 .mid를 붙이고 한글은 그대로 둔다', () => {
    expect(midiFileName('내 연주 · 11월 7일', 3)).toBe('내 연주 · 11월 7일.mid');
  });

  it('금지 문자와 제어 문자를 지운다', () => {
    expect(midiFileName('a\\b/c:d*e?f"g<h>i|j\u0000k\u001fl', 3)).toBe('abcdefghijkl.mid');
  });

  it('앞뒤 공백·마침표를 정리한다', () => {
    expect(midiFileName('  ..연주.. ', 3)).toBe('연주.mid');
  });

  it('80 코드 포인트까지 자른다(이모지는 한 글자)', () => {
    const name = midiFileName('😀'.repeat(100), 3);
    expect([...name]).toHaveLength(80 + 4);
    expect(name.endsWith('.mid')).toBe(true);
  });

  it('자른 뒤 끝에 남은 공백·마침표를 다시 정리한다', () => {
    const title = 'a'.repeat(79) + '. ' + 'b';
    expect(midiFileName(title, 3)).toBe(`${'a'.repeat(79)}.mid`);
  });

  it('정리 결과가 비면 recording-{id}.mid', () => {
    expect(midiFileName('', 7)).toBe('recording-7.mid');
    expect(midiFileName(' ?*:. ', 7)).toBe('recording-7.mid');
  });
});
