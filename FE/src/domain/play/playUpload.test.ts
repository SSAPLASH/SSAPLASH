import { describe, expect, it } from 'vitest';
import type { LoggedHit, LogNote, PlayLog } from './playLog';
import { accuracyPercent, buildUploadBody, uploadInputSource } from './playUpload';

const UUID = '9da79b76-5d88-4875-bc71-c826c3fb4293';
const ctx = { consent: false, appVersion: null };

function note(index: number, over: Partial<LogNote> = {}): LogNote {
  return { index, timeMs: index * 500, pad: 'SNARE', judgement: null, deltaMs: null, noteId: `n${index}`, seq: null, ...over };
}

function hit(seq: number, over: Partial<LoggedHit> = {}): LoggedHit {
  return { hitId: seq, stickId: 1, pad: 'SNARE', velocity: 90.4, tHit: 0, tRecv: 0, tResolved: 0, seq, source: 'keyboard', ...over };
}

/** 노트 3개: 0 PERFECT(+5), 1 MISS, 2 GOOD(−40). 처리 순서: 타격0 → MISS1 → 채보 밖 타격 → 타격2 */
function log(over: Partial<PlayLog> = {}): PlayLog {
  return {
    playId: UUID,
    songId: '12',
    title: 't',
    difficulty: 'EASY',
    mode: 'RHYTHM',
    inputSource: 'keyboard',
    startedAt: '2026-10-27T00:00:00.000Z',
    endedAt: '2026-10-27T00:01:00.000Z',
    durationMs: 60_000,
    timing: { perfectMs: 25, goodMs: 60 },
    calibrationId: null,
    chartVersionId: 77,
    songNumericId: 12,
    chartId: 34,
    presetId: null,
    bpm: 120,
    beatsPerBar: 4,
    hits: [
      hit(0, { judgement: 'PERFECT', matchedNoteIndex: 0, deltaMs: 5, tSongMs: 5 }),
      hit(2, { pad: 'HIHAT', tSongMs: 700 }),
      hit(3, { judgement: 'GOOD', matchedNoteIndex: 2, deltaMs: -40, tSongMs: 960 }),
    ],
    notes: [
      note(0, { judgement: 'PERFECT', deltaMs: 5 }),
      note(1, { judgement: 'MISS', seq: 1 }),
      note(2, { judgement: 'GOOD', deltaMs: -40 }),
    ],
    summary: { score: 180, maxScore: 300, accuracy: 180 / 300, maxCombo: 1, counts: { PERFECT: 1, GOOD: 1, MISS: 1 }, strayHits: 1 },
    audioOffsetMs: 12,
    lastSongTimeMs: 2800,
    elapsedActiveMs: 4800,
    sourceNoteCount: 3,
    ...over,
  };
}

function body(l: PlayLog = log()) {
  const r = buildUploadBody(l, ctx);
  if (!r.ok) throw new Error(r.reason);
  return r.body;
}

describe('accuracyPercent', () => {
  it('score / noteCount를 소수 둘째 자리 HALF_UP으로', () => {
    expect(accuracyPercent(160, 3)).toBe(53.33);
    expect(accuracyPercent(200, 3)).toBe(66.67);
    expect(accuracyPercent(1, 8)).toBe(0.13); // 0.125 → 0.13
    expect(accuracyPercent(300, 3)).toBe(100);
    expect(accuracyPercent(0, 0)).toBe(0);
  });
});

describe('uploadInputSource', () => {
  it('실제 스틱만 STICK, 키보드·포인터는 KEYBOARD', () => {
    expect(uploadInputSource('ble')).toBe('STICK');
    expect(uploadInputSource('webserial')).toBe('STICK');
    expect(uploadInputSource('pointer')).toBe('KEYBOARD');
    expect(uploadInputSource('keyboard')).toBe('KEYBOARD');
  });
});

describe('buildUploadBody', () => {
  it('타격과 MISS를 처리 순서대로 seq 0부터 연속으로', () => {
    const b = body();
    expect(b.hits.map((h) => [h.seq, h.judgement, h.matchedNoteId])).toEqual([
      [0, 'PERFECT', 'n0'],
      [1, 'MISS', 'n1'],
      [2, null, null],
      [3, 'GOOD', 'n2'],
    ]);
  });

  it('판정 타격 tMs = 노트 시각 + Δ, MISS tMs = 노트 시각, 채보 밖은 곡 시각', () => {
    const [p, m, s, g] = body().hits;
    expect(p).toMatchObject({ tMs: 5, deltaMs: 5, velocity: 90 });
    expect(m).toMatchObject({ tMs: 500, deltaMs: null, velocity: null, stickId: null });
    expect(s).toMatchObject({ tMs: 700, pad: 'HIHAT', deltaMs: null });
    expect(g).toMatchObject({ tMs: 960, deltaMs: -40 });
  });

  it('키보드 세션은 센서 필드를 모두 null로', () => {
    for (const h of body().hits) {
      expect([h.stickId, h.peakAccel, h.pitch, h.yaw]).toEqual([null, null, null, null]);
    }
  });

  it('스틱 세션: 센서 타격은 stickId·자세를 싣고, 섞인 키보드 킥은 null', () => {
    const l = log({
      inputSource: 'ble',
      hits: [
        hit(0, { judgement: 'PERFECT', matchedNoteIndex: 0, deltaMs: 5, source: 'ble', stickId: 1, peakAccel: 3.5, pitch: 20, yaw: -10 }),
        hit(2, { pad: 'KICK', tSongMs: 700, source: 'keyboard' }),
        hit(3, { judgement: 'GOOD', matchedNoteIndex: 2, deltaMs: -40, source: 'ble', stickId: 0 }),
      ],
    });
    const b = body(l);
    expect(b.inputSource).toBe('STICK');
    expect(b.hits[0]).toMatchObject({ stickId: 1, peakAccel: 3.5, pitch: 20, yaw: -10 });
    expect(b.hits[2]).toMatchObject({ stickId: null, peakAccel: null });
    expect(b.hits[3]).toMatchObject({ stickId: 0, pitch: null });
  });

  it('집계는 서버 규칙(seq 순서 콤보, 정확도 백분율, SCORE_V2 GOOD 80점)', () => {
    expect(body().summary).toEqual({ score: 180, accuracy: 60, maxCombo: 1, judgementCounts: { perfect: 1, good: 1, miss: 1 } });
  });

  it('판정 컨텍스트·메타·프리셋', () => {
    const b = body(log({ presetId: '5' }));
    expect(b.judgementContext).toEqual({
      schemaVersion: 1,
      judgementVersion: 'SCORE_V2',
      timingWindows: { perfectMs: 25, goodMs: 60 },
      playbackRate: 1,
      padMapping: {},
    });
    expect(b.kitPresetId).toBe(5);
    expect(b.calibration).toEqual({ audioOffsetMs: 12, pads: null });
    expect(b.consent).toBe(false);
    const agreed = buildUploadBody(log(), { ...ctx, consent: true });
    expect(agreed.ok && agreed.body.consent).toBe(true);
    expect(b.clientMeta).toMatchObject({ endReason: 'COMPLETED', lastSongTimeMs: 2800, elapsedActiveMs: 4800 });
  });

  it('clientMeta는 서버 허용 5필드뿐이고 padCountGuide는 본문 어디에도 없다(알 수 없는 필드는 400)', () => {
    const b = body(log({ presetId: '5' }));
    expect(Object.keys(b.clientMeta ?? {}).sort()).toEqual(['appVersion', 'elapsedActiveMs', 'endReason', 'firmwareVersion', 'lastSongTimeMs']);
    expect(JSON.stringify(b)).not.toContain('padCountGuide');
    expect(body(log({ presetId: 'local-1' })).kitPresetId).toBeNull();
  });

  it('패드 없는 타격은 빼고 번호를 다시 매긴다', () => {
    const l = log();
    l.hits.splice(1, 0, hit(1.5, { pad: null }));
    expect(body(l).hits.map((h) => h.seq)).toEqual([0, 1, 2, 3]);
  });

  it('liveCoachEvents: 켠 플레이는 항목을 그대로, 끈 플레이는 LIVE_OFF 한 건, 이전 로그는 빈 배열', () => {
    const on = [
      { tMs: 12000, tag: 'LIVE_LATE', text: '계속 늦게 치고 있어요' },
      { tMs: 31000, tag: 'LIVE_RECOVERED', text: '경향 해소: late' },
    ];
    expect(body(log({ liveCoachEvents: on })).liveCoachEvents).toEqual(on);
    const off = [{ tMs: 0, tag: 'LIVE_OFF', text: '코칭 꺼짐' }];
    expect(body(log({ liveCoachEvents: off })).liveCoachEvents).toEqual(off);
    expect(log().liveCoachEvents).toBeUndefined();
    expect(body(log()).liveCoachEvents).toEqual([]);
  });

  it('업로드하지 않는 경우와 사유', () => {
    const reason = (l: PlayLog) => {
      const r = buildUploadBody(l, ctx);
      return r.ok ? 'ok' : r.reason;
    };
    expect(reason(log({ mode: 'FREE' }))).toBe('FREE_MODE');
    expect(reason(log({ playId: 'play-abc' }))).toBe('LEGACY_LOG');
    expect(reason(log({ hits: [{ ...hit(0), seq: undefined }] }))).toBe('LEGACY_LOG');
    expect(reason(log({ songNumericId: null }))).toBe('BUILTIN_CHART');
    expect(reason(log({ sourceNoteCount: 4 }))).toBe('CHART_MISMATCH');
    expect(reason(log({ notes: [note(0, { noteId: null })] , sourceNoteCount: 1 }))).toBe('CHART_MISMATCH');
  });
});

describe('페달 타격 업로드 (PLAY-002)', () => {
  // 인수 조건: 업로드 본문 stickId null(STICK 모드), 키보드 모드도 null
  it('스틱 세션: stickId null 센서 타격은 stickId null로 나가고 자세 필드는 그대로 허용', () => {
    const l = log({
      inputSource: 'webserial',
      hits: [
        hit(0, { judgement: 'PERFECT', matchedNoteIndex: 0, deltaMs: 5, source: 'webserial', stickId: null, pad: 'KICK', velocity: 100 }),
        hit(2, { pad: 'HIHAT_PEDAL', tSongMs: 700, source: 'webserial', stickId: null }),
        hit(3, { judgement: 'GOOD', matchedNoteIndex: 2, deltaMs: -40, source: 'webserial', stickId: 1 }),
      ],
    });
    const b = body(l);
    expect(b.inputSource).toBe('STICK');
    expect(b.hits[0]).toMatchObject({ stickId: null, pad: 'KICK', velocity: 100 });
    expect(b.hits[2]).toMatchObject({ stickId: null, pad: 'HIHAT_PEDAL' });
    expect(b.hits[3]).toMatchObject({ stickId: 1 });
  });

  it('키보드 세션에 stickId null 타격이 있어도 null', () => {
    const base = log();
    const l = log({ hits: base.hits.map((h, i) => (i === 0 ? { ...h, stickId: null } : h)) });
    expect(body(l).hits[0].stickId).toBeNull();
  });
});

it('로컬 페달 필드는 서버 업로드 계약에 추가하지 않는다', () => {
  const base = log();
  const changed = { ...base, hihatPedalCoverage: 'COMPLETE' as const, notes: base.notes.map((n) => ({ ...n, hihatOpen: true as const })), hits: base.hits.map((h) => ({ ...h, hihatClosed: false })) };
  expect(body(changed)).toEqual(body(base));
});

describe('연습 속도로 친 판 (MODE-003, mail MODE-003_연습-속도-기록-처리)', () => {
  it('배율을 싣고, 판정 타격 tMs = 노트 시각 + 실제 오차 × 배율이다. 오차·판정 폭은 실제 ms 그대로', () => {
    const b = body(log({ playbackRate: 0.7 }));
    expect(b.judgementContext.playbackRate).toBe(0.7);
    expect(b.judgementContext.timingWindows).toEqual({ perfectMs: 25, goodMs: 60 });
    // 노트 0(0ms) +5ms → 3.5, MISS는 노트 시각(500), 채보 밖 타격은 로그의 곡 시각 그대로(700), 노트 2(1000ms) −40ms → 972
    expect(b.hits.map((h) => h.tMs)).toEqual([3.5, 500, 700, 972]);
    expect(b.hits.map((h) => h.deltaMs)).toEqual([5, null, null, -40]);
  });

  it('서버 검사식 (tMs − 노트 시각) ÷ 배율 = 오차가 모든 배율에서 0.001ms 안에 맞는다', () => {
    for (let pct = 50; pct <= 100; pct += 5) {
      const rate = pct / 100;
      const l = log({ playbackRate: rate });
      const b = body(l);
      for (const h of b.hits) {
        if (h.judgement === null || h.judgement === 'MISS') continue;
        const n = l.notes.find((x) => x.noteId === h.matchedNoteId)!;
        expect(Math.abs(h.deltaMs! - (h.tMs - n.timeMs) / rate)).toBeLessThan(0.001);
      }
    }
  });

  it('배율이 없거나 1이면 본문이 지금과 같다', () => {
    expect(body(log({ playbackRate: 1 }))).toEqual(body(log()));
    expect(body(log()).judgementContext.playbackRate).toBe(1);
    expect(body(log()).hits.map((h) => h.tMs)).toEqual([5, 500, 700, 960]);
  });
});

