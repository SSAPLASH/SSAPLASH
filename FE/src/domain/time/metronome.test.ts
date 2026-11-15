// 메트로놈 순수 로직 검증: 박 시각·현재 박·창 조회·rebase·탭 템포·클램프.
import { describe, expect, it } from 'vitest';
import {
  BPM_DEFAULT,
  BPM_MAX,
  BPM_MIN,
  TAP_MAX,
  TAP_RESET_MS,
  beatAt,
  beatIndexAt,
  beatIntervalMs,
  beatsInWindow,
  clampBpm,
  isSubdivisionPref,
  previewTicks,
  pushTap,
  rebaseBpm,
  resolveSubdivision,
  retick,
  subdivisionHint,
  tapBpm,
  tickAt,
  ticksInWindow,
  type BeatClock,
  type TapState,
} from './metronome';

const clock: BeatClock = { anchorMs: 1000, anchorIndex: 0, bpm: 120, beatsPerBar: 4 };

describe('clampBpm', () => {
  it('범위로 자르고 반올림한다', () => {
    expect(clampBpm(10)).toBe(BPM_MIN);
    expect(clampBpm(999)).toBe(BPM_MAX);
    expect(clampBpm(100.6)).toBe(101);
  });
  it('NaN·무한대는 기본값', () => {
    expect(clampBpm(NaN)).toBe(BPM_DEFAULT);
    expect(clampBpm(Infinity)).toBe(BPM_DEFAULT);
  });
});

describe('beatAt', () => {
  it('120BPM이면 500ms 간격, 첫 박만 악센트', () => {
    expect(beatIntervalMs(120)).toBe(500);
    expect(beatAt(clock, 0)).toEqual({ index: 0, beatInBar: 0, accent: true, atMs: 1000 });
    expect(beatAt(clock, 1)).toMatchObject({ beatInBar: 1, accent: false, atMs: 1500 });
    expect(beatAt(clock, 4)).toMatchObject({ beatInBar: 0, accent: true, atMs: 3000 });
  });
  it('3/4는 3박마다 악센트', () => {
    const c3: BeatClock = { ...clock, beatsPerBar: 3 };
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => beatAt(c3, i).accent)).toEqual([true, false, false, true, false, false, true]);
  });
  it('기준점 이전 인덱스도 계산된다', () => {
    expect(beatAt(clock, -1)).toMatchObject({ beatInBar: 3, atMs: 500 });
  });
});

describe('beatIndexAt', () => {
  it('가장 최근에 울린 박', () => {
    expect(beatIndexAt(clock, 1000)).toBe(0);
    expect(beatIndexAt(clock, 1499)).toBe(0);
    expect(beatIndexAt(clock, 1500)).toBe(1);
  });
  it('시작 전이면 anchorIndex − 1', () => {
    expect(beatIndexAt(clock, 900)).toBe(-1);
  });
});

describe('beatsInWindow', () => {
  it('[from, to) 안의 박만, 순서대로', () => {
    const b = beatsInWindow(clock, 1000, 2500, 0);
    expect(b.map((x) => x.atMs)).toEqual([1000, 1500, 2000]);
  });
  it('fromIndex부터 시작', () => {
    expect(beatsInWindow(clock, 0, 2100, 2).map((x) => x.index)).toEqual([2]);
  });
  it('창에 박이 없으면 빈 배열', () => {
    expect(beatsInWindow(clock, 1100, 1400, 1)).toEqual([]);
  });
});

describe('rebaseBpm', () => {
  it('다음 박의 시각을 보존하고 그 뒤부터 새 간격', () => {
    const next = rebaseBpm(clock, 60, 1600, 2); // 박 2는 2000ms
    expect(beatAt(next, 2).atMs).toBe(2000);
    expect(beatAt(next, 3).atMs).toBe(3000);
    expect(next.anchorIndex).toBe(2);
  });
  it('마디 안 위치(인덱스)가 이어진다', () => {
    const next = rebaseBpm(clock, 90, 1600, 5);
    expect(beatAt(next, 5).beatInBar).toBe(1);
    expect(beatAt(next, 8).beatInBar).toBe(0);
  });
  it('범위 밖 BPM은 클램프', () => {
    expect(rebaseBpm(clock, 9999, 0, 1).bpm).toBe(BPM_MAX);
  });
});

describe('탭 템포', () => {
  const tapAll = (times: number[]): TapState => times.reduce<TapState>((s, t) => pushTap(s, t), { taps: [] });

  it('탭 1개면 null, 2개부터 BPM', () => {
    expect(tapBpm(tapAll([0]))).toBeNull();
    expect(tapBpm(tapAll([0, 500]))).toBe(120);
  });
  it('여러 탭의 평균 간격', () => {
    expect(tapBpm(tapAll([0, 500, 1000, 1500, 2000]))).toBe(120);
    expect(tapBpm(tapAll([0, 400, 800, 1200]))).toBe(150);
  });
  it('TAP_RESET_MS 이상 쉬면 새로 시작', () => {
    const s = tapAll([0, 500, 1000, 1000 + TAP_RESET_MS]);
    expect(s.taps).toEqual([1000 + TAP_RESET_MS]);
    expect(tapBpm(s)).toBeNull();
  });
  it('TAP_MAX를 넘으면 오래된 탭을 버린다', () => {
    const s = tapAll(Array.from({ length: 12 }, (_, i) => i * 500));
    expect(s.taps).toHaveLength(TAP_MAX);
    expect(s.taps[0]).toBe(4 * 500);
  });
  it('결과는 범위로 자른다', () => {
    expect(tapBpm(tapAll([0, 100]))).toBe(BPM_MAX);
    expect(tapBpm(tapAll([0, 1900]))).toBe(BPM_MIN);
  });
});

describe('박 분할 (설계 MODE-002-MODE-003-metronome-subdivision)', () => {
  it('고른 값을 박당 클릭 수로 푼다. 자동은 BPM 90 미만이면 8분', () => {
    expect(resolveSubdivision('quarter', 60)).toBe(1);
    expect(resolveSubdivision('eighth', 200)).toBe(2);
    expect(resolveSubdivision('auto', 85)).toBe(2);
    expect(resolveSubdivision('auto', 89.9)).toBe(2);
    expect(resolveSubdivision('auto', 90)).toBe(1);
    expect(resolveSubdivision('auto', 128)).toBe(1);
    expect(resolveSubdivision('auto', NaN)).toBe(1);
  });

  it('저장 값 검사: 세 값만 통과', () => {
    expect(['auto', 'quarter', 'eighth'].every(isSubdivisionPref)).toBe(true);
    expect([undefined, null, 2, 'sixteenth', ''].some(isSubdivisionPref)).toBe(false);
  });

  it('8분: 사이 박은 앞뒤 정박의 정확히 가운데, 소리 단계는 첫 박·사이 박·정박', () => {
    expect(tickAt(clock, 0, 2)).toEqual({ tick: 0, beatInBar: 0, level: 'accent', isBeat: true, atMs: 1000 });
    expect(tickAt(clock, 1, 2)).toEqual({ tick: 1, beatInBar: 0, level: 'sub', isBeat: false, atMs: 1250 });
    expect(tickAt(clock, 2, 2)).toEqual({ tick: 2, beatInBar: 1, level: 'beat', isBeat: true, atMs: 1500 });
    expect(tickAt(clock, 7, 2)).toMatchObject({ beatInBar: 3, level: 'sub', atMs: 2750 });
    expect(tickAt(clock, 8, 2)).toMatchObject({ beatInBar: 0, level: 'accent', atMs: 3000 });
    // 정박 사이 가운데: 어떤 BPM에서도 오차 없이(1ms 이내)
    const c77: BeatClock = { ...clock, bpm: 77 };
    for (let b = 0; b < 16; b++) {
      const mid = (tickAt(c77, 2 * b, 2).atMs + tickAt(c77, 2 * b + 2, 2).atMs) / 2;
      expect(Math.abs(tickAt(c77, 2 * b + 1, 2).atMs - mid)).toBeLessThan(1);
    }
  });

  it('4분: 틱이 곧 박이라 beatAt과 같다', () => {
    for (const i of [0, 1, 3, 4, 9]) {
      const b = beatAt(clock, i);
      expect(tickAt(clock, i, 1)).toEqual({ tick: i, beatInBar: b.beatInBar, level: b.accent ? 'accent' : 'beat', isBeat: true, atMs: b.atMs });
    }
  });

  it('창 조회는 beatsInWindow와 같은 규칙([from, to))', () => {
    expect(ticksInWindow(clock, 2, 1000, 1500, 0).map((t) => t.tick)).toEqual([0, 1]);
    expect(ticksInWindow(clock, 2, -Infinity, 1501, 1).map((t) => t.tick)).toEqual([1, 2]);
    expect(ticksInWindow(clock, 1, 1000, 2001, 0).map((t) => t.tick)).toEqual(beatsInWindow(clock, 1000, 2001, 0).map((b) => b.index));
  });

  it('분할이 바뀌면 다음 틱을 같은 박 위치 이상으로 옮긴다', () => {
    expect(retick(7, 2, 1)).toBe(4); // 3.5박 → 다음 정박 4
    expect(retick(6, 2, 1)).toBe(3); // 3박 그대로
    expect(retick(4, 1, 2)).toBe(8); // 4박 그대로(틱 번호만 두 배)
    expect(retick(5, 2, 2)).toBe(5);
  });

  it('기준점이 사이 박(소수)이어도 현재 박은 정수이고 rebase는 그 위치의 시각을 지킨다', () => {
    const next = rebaseBpm(clock, 60, 0, 1.5); // 1.5박 = 1750ms
    expect(next).toMatchObject({ anchorMs: 1750, anchorIndex: 1.5, bpm: 60 });
    expect(beatIndexAt(next, 1700)).toBe(1);
    expect(beatIndexAt(next, 1750)).toBe(1);
    expect(beatIndexAt(next, 2249)).toBe(1);
    expect(beatIndexAt(next, 2250)).toBe(2); // 60bpm 반 박 = 500ms 뒤가 2박
    expect(tickAt(next, 4, 2).atMs).toBe(2250);
  });
});

describe('박 분할 풀이 문구·예시 소리', () => {
  it('자동은 기준 BPM으로 풀어 적는다. 곡은 BPM을 정수로 반올림해 적는다', () => {
    expect(subdivisionHint('auto', 72, 'song')).toBe('BPM 72 곡이라 8분음표로 울려요');
    expect(subdivisionHint('auto', 78.43, 'song')).toBe('BPM 78 곡이라 8분음표로 울려요');
    expect(subdivisionHint('auto', 128, 'song')).toBe('BPM 128 곡이라 4분음표로 울려요');
    expect(subdivisionHint('auto', 85, 'metronome')).toBe('지금 BPM에서는 8분음표로 울려요');
    expect(subdivisionHint('auto', 90, 'metronome')).toBe('지금 BPM에서는 4분음표로 울려요');
    // 반올림하면 90이지만 판정은 원래 값(89.6)으로 한다
    expect(subdivisionHint('auto', 89.6, 'song')).toBe('BPM 90 곡이라 8분음표로 울려요');
  });

  it('4분·8분은 BPM과 무관한 문구, 자동인데 BPM을 모르면 빈 문자열', () => {
    expect(subdivisionHint('quarter', 60, 'song')).toBe('박마다 한 번 울려요');
    expect(subdivisionHint('eighth', undefined, 'metronome')).toBe('박 사이에 한 번 더 울려요');
    expect(subdivisionHint('auto', undefined, 'song')).toBe('');
  });

  it('예시 소리는 두 박: 4분이면 2번, 8분이면 4번, 첫 틱만 강세', () => {
    expect(previewTicks(120, 1)).toEqual([
      { offsetMs: 0, level: 'accent', beat: 0 },
      { offsetMs: 500, level: 'beat', beat: 1 },
    ]);
    expect(previewTicks(120, 2)).toEqual([
      { offsetMs: 0, level: 'accent', beat: 0 },
      { offsetMs: 250, level: 'sub', beat: null },
      { offsetMs: 500, level: 'beat', beat: 1 },
      { offsetMs: 750, level: 'sub', beat: null },
    ]);
    expect(previewTicks(NaN, 2)).toEqual([]);
    expect(previewTicks(0, 1)).toEqual([]);
  });
});
