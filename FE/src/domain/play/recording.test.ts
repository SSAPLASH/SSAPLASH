import { describe, expect, it } from 'vitest';
import type { ResolvedHit } from '@/domain/events';
import type { LoggedHit } from './playLog';
import {
  MAX_RECORDING_HITS,
  buildRecordingBody,
  decideInputSource,
  defaultRecordingTitle,
  hitFromFreeInput,
  hitsFromPlayLog,
  isRecordedSensor,
  normalizeRecordingTitle,
} from './recording';

function logged(o: Partial<LoggedHit> = {}): LoggedHit {
  return { hitId: 1, stickId: 0, pad: 'SNARE', velocity: 100, tHit: 0, tRecv: 0, tResolved: 0, tSongMs: 1000, source: 'keyboard', ...o };
}

function resolved(o: Partial<ResolvedHit> = {}): ResolvedHit {
  return {
    id: 1, stickId: 1, pad: 'SNARE', velocity: 90, tHit: 1500, tRecv: 1500, tResolved: 1500,
    source: 'keyboard', pose: { pitch: 0, yaw: 0 }, peakAccel: 0, judgedBy: 'key', ...o,
  };
}

describe('hitsFromPlayLog', () => {
  it('tSongMs가 없거나 음수인 타격과 pad null 타격을 뺀다', () => {
    const { hits } = hitsFromPlayLog([
      logged({ tSongMs: undefined }),
      logged({ tSongMs: -1 }),
      logged({ pad: null }),
      logged({ tSongMs: 0 }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].tMs).toBe(0);
  });

  it('tMs 오름차순으로 정렬하고 같은 값은 입력 순서를 지킨다', () => {
    const { hits } = hitsFromPlayLog([
      logged({ tSongMs: 300, pad: 'KICK' }),
      logged({ tSongMs: 100, pad: 'SNARE' }),
      logged({ tSongMs: 100, pad: 'CRASH' }),
    ]);
    expect(hits.map((h) => h.tMs)).toEqual([100, 100, 300]);
    expect(hits.map((h) => h.pad)).toEqual(['SNARE', 'CRASH', 'KICK']);
  });

  it('velocity를 반올림하고 0~127로 고정한다', () => {
    const { hits } = hitsFromPlayLog([logged({ velocity: 99.6, tSongMs: 1 }), logged({ velocity: 300, tSongMs: 2 }), logged({ velocity: -5, tSongMs: 3 })]);
    expect(hits.map((h) => h.velocity)).toEqual([100, 127, 0]);
  });

  it('키보드·포인터·source 없는 타격은 stickId 키 자체가 없다', () => {
    const { hits, hasSensor } = hitsFromPlayLog([
      logged({ source: 'keyboard', stickId: 1 }),
      logged({ source: 'pointer', stickId: 1 }),
      logged({ source: undefined, stickId: 1 }),
    ]);
    expect(hits).toHaveLength(3);
    for (const h of hits) expect('stickId' in h).toBe(false);
    expect(hasSensor).toBe(false);
  });

  it('화면 터치 타격은 센서가 아니다(stickId 없음, hasSensor false → KEYBOARD)', () => {
    const { hits, hasSensor } = hitsFromPlayLog([logged({ source: 'touch', stickId: 1 })]);
    expect('stickId' in hits[0]).toBe(false);
    expect(hasSensor).toBe(false);
    expect(decideInputSource(hasSensor)).toBe('KEYBOARD');
    expect('stickId' in hitFromFreeInput(resolved({ source: 'touch', stickId: 1 }), 0)!).toBe(false);
  });

  it('센서 타격에는 stickId 0·1이 들어가고 hasSensor가 true다', () => {
    const { hits, hasSensor } = hitsFromPlayLog([
      logged({ source: 'ble', stickId: 0, tSongMs: 1 }),
      logged({ source: 'ble', stickId: 1, tSongMs: 2 }),
    ]);
    expect(hits.map((h) => h.stickId)).toEqual([0, 1]);
    expect(hasSensor).toBe(true);
  });

  it('50,000개를 넘으면 앞에서 50,000개만 남긴다', () => {
    const many = Array.from({ length: MAX_RECORDING_HITS + 5 }, (_, i) => logged({ tSongMs: i }));
    const { hits } = hitsFromPlayLog(many);
    expect(hits).toHaveLength(MAX_RECORDING_HITS);
    expect(hits[hits.length - 1].tMs).toBe(MAX_RECORDING_HITS - 1);
  });
});

describe('hitFromFreeInput', () => {
  it('pad가 null이면 null', () => {
    expect(hitFromFreeInput(resolved({ pad: null }), 0)).toBeNull();
  });

  it('tMs는 tHit − 시작이고 음수면 0이다', () => {
    expect(hitFromFreeInput(resolved({ tHit: 1500 }), 1000)?.tMs).toBe(500);
    expect(hitFromFreeInput(resolved({ tHit: 900 }), 1000)?.tMs).toBe(0);
  });

  it('키보드·포인터는 stickId 키가 없고 센서는 stickId가 있다', () => {
    const kb = hitFromFreeInput(resolved({ source: 'keyboard' }), 0)!;
    const pt = hitFromFreeInput(resolved({ source: 'pointer' }), 0)!;
    const ble0 = hitFromFreeInput(resolved({ source: 'ble', stickId: 0 }), 0)!;
    const ble1 = hitFromFreeInput(resolved({ source: 'ble', stickId: 1 }), 0)!;
    expect('stickId' in kb).toBe(false);
    expect('stickId' in pt).toBe(false);
    expect(ble0.stickId).toBe(0);
    expect(ble1.stickId).toBe(1);
  });

  it('velocity를 정수 0~127로 고정한다', () => {
    expect(hitFromFreeInput(resolved({ velocity: 127.4 }), 0)?.velocity).toBe(127);
    expect(hitFromFreeInput(resolved({ velocity: 130 }), 0)?.velocity).toBe(127);
    expect(hitFromFreeInput(resolved({ velocity: 64.5 }), 0)?.velocity).toBe(65);
  });
});

describe('decideInputSource', () => {
  it('센서 타격이 있으면 STICK', () => {
    expect(decideInputSource(true)).toBe('STICK');
    expect(decideInputSource(false)).toBe('KEYBOARD');
  });
});

describe('defaultRecordingTitle', () => {
  const at = new Date(2026, 10, 3, 9, 5);

  it('곡 제목 · M월 D일 HH:mm 형식이다', () => {
    expect(defaultRecordingTitle('봄날', at)).toBe('봄날 · 11월 3일 09:05');
  });

  it('곡이 없으면 "자유 연습"', () => {
    expect(defaultRecordingTitle(null, at)).toBe('자유 연습 · 11월 3일 09:05');
  });

  it('100자를 넘으면 곡 제목을 잘라 …를 붙이고 날짜시각은 남긴다', () => {
    const t = defaultRecordingTitle('가'.repeat(200), at);
    expect([...t]).toHaveLength(100);
    expect(t.endsWith('… · 11월 3일 09:05')).toBe(true);
  });

  it('이모지는 코드 포인트 하나로 센다', () => {
    const t = defaultRecordingTitle('🥁'.repeat(200), at);
    expect([...t]).toHaveLength(100);
    expect(t).toContain('🥁… · 11월 3일 09:05');
  });

  it('딱 100자면 자르지 않는다', () => {
    const suffix = ' · 11월 3일 09:05';
    const name = '나'.repeat(100 - [...suffix].length);
    expect(defaultRecordingTitle(name, at)).toBe(name + suffix);
  });
});

describe('normalizeRecordingTitle', () => {
  it('앞뒤 공백을 지우고 비면 fallback을 쓴다', () => {
    expect(normalizeRecordingTitle('  안녕  ', 'x')).toBe('안녕');
    expect(normalizeRecordingTitle('   ', 'x')).toBe('x');
    expect(normalizeRecordingTitle('', 'x')).toBe('x');
  });

  it('100 코드 포인트를 넘으면 자른다', () => {
    const out = normalizeRecordingTitle('🥁'.repeat(150), 'x');
    expect([...out]).toHaveLength(100);
  });
});

describe('buildRecordingBody', () => {
  const startedAt = new Date('2026-11-03T01:02:03.000Z');
  const base = { clientKey: 'k', title: 't', mode: 'FREE' as const, hasSensor: false, startedAt, baseDurationMs: 1000 };
  const hit = { tMs: 10, pad: 'SNARE' as const, velocity: 100 };

  it('필드가 계약과 같고 playId가 없으면 키가 없다', () => {
    const body = buildRecordingBody({ ...base, hits: [hit] });
    expect(body).toEqual({
      schemaVersion: 1, clientKey: 'k', title: 't', mode: 'FREE', inputSource: 'KEYBOARD',
      startedAt: '2026-11-03T01:02:03.000Z', durationMs: 1000, hits: [hit],
    });
    expect('playId' in body).toBe(false);
    expect('playId' in buildRecordingBody({ ...base, playId: null, hits: [hit] })).toBe(false);
  });

  it('playId가 있으면 싣고 센서면 STICK', () => {
    const body = buildRecordingBody({ ...base, mode: 'RHYTHM', hasSensor: true, playId: 'p1', hits: [hit] });
    expect(body.playId).toBe('p1');
    expect(body.inputSource).toBe('STICK');
  });

  it('durationMs는 마지막 tMs 이상의 정수로 보정한다', () => {
    expect(buildRecordingBody({ ...base, baseDurationMs: 500, hits: [{ ...hit, tMs: 800.2 }] }).durationMs).toBe(801);
    expect(buildRecordingBody({ ...base, baseDurationMs: 1000.4, hits: [hit] }).durationMs).toBe(1001);
  });
});

describe('페달 타격(stickId null, PLAY-002)', () => {
  // 인수 조건: 녹음 stickId 키 없음(null이면 서버가 400)
  it('hitsFromPlayLog: stickId null 센서 타격은 stickId 키가 없고 hasSensor는 true', () => {
    const { hits, hasSensor } = hitsFromPlayLog([
      logged({ source: 'webserial', stickId: null, pad: 'KICK', tSongMs: 1 }),
      logged({ source: 'webserial', stickId: 0, tSongMs: 2 }),
    ]);
    expect('stickId' in hits[0]).toBe(false);
    expect(hits[1].stickId).toBe(0);
    expect(hasSensor).toBe(true);
  });

  it('hitFromFreeInput: stickId null 센서 타격은 stickId 키가 없다', () => {
    const h = hitFromFreeInput(resolved({ source: 'webserial', stickId: null, pad: 'KICK' }), 0)!;
    expect(h.pad).toBe('KICK');
    expect('stickId' in h).toBe(false);
  });

  it('isRecordedSensor: 센서 소스만 true(키보드·톡 치기·터치·포인터·없음 제외)', () => {
    expect(isRecordedSensor('webserial')).toBe(true);
    expect(isRecordedSensor('keyboard')).toBe(false);
    expect(isRecordedSensor('preview')).toBe(false);
    expect(isRecordedSensor('touch')).toBe(false);
    expect(isRecordedSensor('pointer')).toBe(false);
    expect(isRecordedSensor(undefined)).toBe(false);
  });
});
