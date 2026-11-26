import { describe, expect, it } from 'vitest';
import type { PadId } from '@/domain/kit/pads';
import {
  CHART_MIN_SCALE_MS,
  COUNT_IN_BEATS,
  COUNT_IN_LEAD_MS,
  IDLE_LIMIT_MS,
  MIN_GAP_RATIO,
  STEADY_BAND_MS,
  GOOD_BAND_MS,
  hitGrade,
  TAIL_HITS,
  TEMPO_BPMS,
  TEMPO_CLOSING_MS,
  TEMPO_HITS,
  acceptsHit,
  averageErrorMs,
  chartScaleMs,
  collectTempoHits,
  endBpm,
  flowCell,
  formatBpm,
  isTempoDetail,
  measureStartAt,
  pickBpm,
  placeHit,
  tempoBestNote,
  tempoFlow,
  tempoRemark,
  tempoResultTitle,
  worstHit,
  type TempoHit,
} from './tempoRound';

/** 오차만 있는 타격 목록 */
const errs = (...errorMs: number[]) => errorMs.map((e) => ({ errorMs: e }));
const hit = (at: number, pad: PadId | null = 'SNARE') => ({ pad, at });

describe('상수', () => {
  it('설계 값과 같다', () => {
    expect(TEMPO_HITS).toBe(16);
    expect(TEMPO_BPMS).toEqual([80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120]);
    expect(TEMPO_BPMS).toHaveLength(11);
    expect(COUNT_IN_BEATS).toBe(8);
    expect(COUNT_IN_LEAD_MS).toBe(600);
    expect(MIN_GAP_RATIO).toBe(0.4);
    expect(IDLE_LIMIT_MS).toBe(5000);
    expect(TEMPO_CLOSING_MS).toBe(600);
    expect(STEADY_BAND_MS).toBe(10);
    expect(TAIL_HITS).toBe(4);
    expect(CHART_MIN_SCALE_MS).toBe(40);
  });
});

describe('hitGrade', () => {
  it('절댓값이 10 이하면 perfect다(경계 포함, 빠름·늦음 같다)', () => {
    expect(hitGrade(0)).toBe('perfect');
    expect(hitGrade(10)).toBe('perfect');
    expect(hitGrade(-10)).toBe('perfect');
  });

  it('10을 넘고 25 이하면 good이다(경계 포함)', () => {
    expect(hitGrade(11)).toBe('good');
    expect(hitGrade(-11)).toBe('good');
    expect(hitGrade(25)).toBe('good');
    expect(hitGrade(-25)).toBe('good');
  });

  it('25를 넘으면 off다', () => {
    expect(hitGrade(26)).toBe('off');
    expect(hitGrade(-26)).toBe('off');
    expect(hitGrade(400)).toBe('off');
  });

  it('경계 상수는 정박 10 · 가까움 25다', () => {
    expect(STEADY_BAND_MS).toBe(10);
    expect(GOOD_BAND_MS).toBe(25);
  });
});

describe('pickBpm', () => {
  it('항상 목록의 값이고 직전 값과 다르다', () => {
    for (const previous of TEMPO_BPMS) {
      for (let i = 0; i <= 50; i += 1) {
        const bpm = pickBpm(previous, () => i / 50);
        expect(TEMPO_BPMS).toContain(bpm);
        expect(bpm).not.toBe(previous);
      }
    }
  });

  it('직전 값이 없으면 열한 값 모두 나올 수 있다', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 11; i += 1) seen.add(pickBpm(null, () => (i + 0.5) / 11));
    expect([...seen].sort((a, b) => a - b)).toEqual([...TEMPO_BPMS]);
  });

  it('난수 0은 첫 후보, 0.999999는 마지막 후보', () => {
    expect(pickBpm(null, () => 0)).toBe(80);
    expect(pickBpm(null, () => 0.999999)).toBe(120);
    expect(pickBpm(80, () => 0)).toBe(84);
    expect(pickBpm(120, () => 0.999999)).toBe(116);
  });

  it('난수가 1이어도 올바른 값', () => {
    expect(pickBpm(null, () => 1)).toBe(120);
    expect(TEMPO_BPMS).toContain(pickBpm(96, () => 1));
  });

  it('목록에 없는 직전 값은 null과 같다', () => {
    expect(pickBpm(97, () => 0)).toBe(80);
    expect(pickBpm(97, () => 0.999999)).toBe(120);
  });
});

describe('measureStartAt', () => {
  it('마지막 예비 박에서 박 간격의 절반 뒤', () => {
    expect(measureStartAt(1000, 120)).toBe(1250);
    expect(measureStartAt(1000, 80)).toBe(1375);
  });
});

describe('acceptsHit', () => {
  it('패드가 판정되지 않으면 거부', () => {
    expect(acceptsHit(hit(2000, null), 1000, null, 120)).toBe(false);
  });

  it('어느 패드든 판정됐으면 받는다', () => {
    for (const pad of ['SNARE', 'KICK', 'HIHAT_PEDAL', 'CRASH'] as const) {
      expect(acceptsHit(hit(2000, pad), 1000, null, 120)).toBe(true);
    }
  });

  it('측정 시작보다 1ms 이르면 거부, 정각이면 받는다', () => {
    expect(acceptsHit(hit(999), 1000, null, 120)).toBe(false);
    expect(acceptsHit(hit(1000), 1000, null, 120)).toBe(true);
  });

  it('앞 타격과의 간격이 박 간격의 40% 이상이어야 한다', () => {
    expect(acceptsHit(hit(2200), 1000, 2000, 120)).toBe(true);
    expect(acceptsHit(hit(2199), 1000, 2000, 120)).toBe(false);
    expect(acceptsHit(hit(2300), 1000, 2000, 80)).toBe(true);
    expect(acceptsHit(hit(2299), 1000, 2000, 80)).toBe(false);
  });

  it('앞 타격이 없으면 간격을 보지 않는다', () => {
    expect(acceptsHit(hit(1000), 1000, null, 120)).toBe(true);
  });
});

describe('placeHit', () => {
  const first: TempoHit = { at: 1000, beat: 0, errorMs: 0 };

  it('첫 타는 박 0·오차 0', () => {
    expect(placeHit([], 1234, 120)).toEqual({ at: 1234, beat: 0, errorMs: 0 });
  });

  it('둘째 타는 가장 가까운 박과 짝짓는다', () => {
    expect(placeHit([first], 1510, 120)).toEqual({ at: 1510, beat: 1, errorMs: 10 });
    expect(placeHit([first], 1480, 120)).toEqual({ at: 1480, beat: 1, errorMs: -20 });
  });

  it('한 박을 건너뛰어도 오차가 한 박만큼 밀리지 않는다', () => {
    expect(placeHit([first], 2010, 120)).toEqual({ at: 2010, beat: 2, errorMs: 10 });
  });

  it('앞 타의 박보다 반드시 커야 한다(같은 박에 두 번 놓지 않는다)', () => {
    const prev: TempoHit = { at: 2500, beat: 3, errorMs: 0 };
    expect(placeHit([first, prev], 1000 + 3 * 500 + 240, 120)).toEqual({ at: 2740, beat: 4, errorMs: -260 });
  });

  it('정확히 중간이면 Math.round를 따른다', () => {
    expect(placeHit([first], 1750, 120)).toEqual({ at: 1750, beat: 2, errorMs: -250 });
  });
});

describe('collectTempoHits', () => {
  const grid = (n: number, from = 1000, step = 500) => Array.from({ length: n }, (_, i) => hit(from + i * step));

  it('measureFrom이 없으면 아무것도 세지 않는다', () => {
    expect(collectTempoHits(null, grid(5), 120)).toEqual([]);
  });

  it('측정 시작 전 타격은 버리고 처음 센 타가 박 0·오차 0', () => {
    const result = collectTempoHits(1000, [hit(900), hit(1100), hit(1600)], 120);
    expect(result).toEqual([
      { at: 1100, beat: 0, errorMs: 0 },
      { at: 1600, beat: 1, errorMs: 0 },
    ]);
  });

  it('박에 맞춘 16타는 박 0~15·오차 0이고 17번째는 무시한다', () => {
    const result = collectTempoHits(1000, grid(17), 120);
    expect(result).toHaveLength(16);
    expect(result.map((h) => h.beat)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(result.every((h) => h.errorMs === 0)).toBe(true);
  });

  it('겹친 타격은 버리고 칸을 쓰지 않는다', () => {
    const hits = [hit(1000), hit(1100), hit(1500), hit(1550), hit(2000)];
    const result = collectTempoHits(1000, hits, 120);
    expect(result.map((h) => h.at)).toEqual([1000, 1500, 2000]);
  });

  it('패드가 판정되지 않은 타격은 버린다', () => {
    const result = collectTempoHits(1000, [hit(1000), hit(1500, null), hit(2000)], 120);
    expect(result.map((h) => h.at)).toEqual([1000, 2000]);
    expect(result[1].beat).toBe(2);
  });

  it('박을 건너뛰어도 뒤 타격의 오차는 작고 박 번호는 이어진다', () => {
    const at = [0, 1, 2, 3, 4, 6, 7].map((k) => 1000 + k * 500);
    const result = collectTempoHits(
      1000,
      at.map((a) => hit(a)),
      120,
    );
    expect(result.map((h) => h.beat)).toEqual([0, 1, 2, 3, 4, 6, 7]);
    expect(result.every((h) => h.errorMs === 0)).toBe(true);
  });

  it('늦게 도착해 시각이 앞선 타격은 버리고 앞의 결과는 바뀌지 않는다', () => {
    const before = collectTempoHits(1000, [hit(1000), hit(1500)], 120);
    const after = collectTempoHits(1000, [hit(1000), hit(1500), hit(1200)], 120);
    expect(after).toEqual(before);
  });
});

describe('averageErrorMs', () => {
  it('첫 타를 빼고 절대 오차의 평균', () => {
    expect(averageErrorMs(errs(0, 10, -20, 30))).toBe(20);
  });

  it('타가 하나 이하면 null', () => {
    expect(averageErrorMs(errs(0))).toBeNull();
    expect(averageErrorMs([])).toBeNull();
  });
});

describe('worstHit', () => {
  it('2번째 타부터 가장 큰 절대 오차의 번호(1부터)와 오차', () => {
    expect(worstHit(errs(0, 5, -34, 20))).toEqual({ index: 3, errorMs: -34 });
  });

  it('같으면 앞의 타', () => {
    expect(worstHit(errs(0, 10, -10, 10))).toEqual({ index: 2, errorMs: 10 });
  });

  it('첫 타는 뽑지 않는다', () => {
    expect(worstHit(errs(0, 0, 0))).toEqual({ index: 2, errorMs: 0 });
  });

  it('타가 하나 이하면 null', () => {
    expect(worstHit(errs(0))).toBeNull();
    expect(worstHit([])).toBeNull();
  });
});

describe('endBpm', () => {
  const at = (beats: number[], interval: number) => beats.map((beat) => ({ beat, at: beat * interval }));

  it('박에 맞춘 96 BPM은 96.0', () => {
    expect(endBpm(at([0, 1, 2, 3, 4, 5], 625))).toBe(96);
  });

  it('점점 빨라지면 제시한 빠르기보다 높다', () => {
    expect(endBpm(at([0, 1, 2, 3, 4, 5], 600))).toBe(100);
    expect(endBpm(at([0, 1, 2, 3, 4, 5], 600))).toBeGreaterThan(96);
  });

  it('끝 네 타 안에서 박을 건너뛰어도 박 번호로 계산해 참 빠르기에 가깝다', () => {
    expect(endBpm(at([0, 1, 2, 3, 5, 6], 625))).toBe(96);
  });

  it('소수 한 자리로 반올림한다', () => {
    const hits = [0, 1, 2, 3, 4, 5].map((beat) => ({ beat, at: beat * 620 }));
    expect(endBpm(hits)).toBe(96.8);
  });

  it('타가 5개 미만이면 null', () => {
    expect(endBpm(at([0, 1, 2, 3], 625))).toBeNull();
    expect(endBpm([])).toBeNull();
  });

  it('시간 차이가 0 이하면 null', () => {
    const same = [0, 1, 2, 3, 4, 5].map((beat) => ({ beat, at: 1000 }));
    expect(endBpm(same)).toBeNull();
    const back = [0, 1, 2, 3, 4, 5].map((beat) => ({ beat, at: 5000 - beat * 100 }));
    expect(endBpm(back)).toBeNull();
  });
});

describe('tempoFlow', () => {
  it('마지막 4타 평균이 -10 이하면 빨라짐', () => {
    expect(tempoFlow(errs(0, 0, 0, 0, -10, -10, -10, -10)).kind).toBe('faster');
    expect(tempoFlow(errs(-40, 0, 0, 0)).kind).toBe('faster');
  });

  it('+10 이상이면 느려짐', () => {
    expect(tempoFlow(errs(10, 10, 10, 10)).kind).toBe('slower');
    expect(tempoFlow(errs(40, 0, 0, 0)).kind).toBe('slower');
  });

  it('경계 안쪽은 고름: -9.75, +9.75', () => {
    expect(tempoFlow(errs(-39, 0, 0, 0))).toEqual({ kind: 'steady' });
    expect(tempoFlow(errs(39, 0, 0, 0))).toEqual({ kind: 'steady' });
  });

  it('from은 그 뒤로 끝까지 같은 쪽으로 벗어난 첫 타의 번호', () => {
    expect(tempoFlow(errs(0, 2, -3, 4, -12, -15, -14, -20))).toEqual({ kind: 'faster', from: 5 });
  });

  it('설계 기준: 16타 중 5~16번째가 모두 빠르면 5번째부터 빨라짐', () => {
    const errors = [0, 3, -2, 4, ...Array.from({ length: 12 }, () => -15)];
    expect(errors).toHaveLength(16);
    expect(tempoFlow(errs(...errors))).toEqual({ kind: 'faster', from: 5 });
  });

  it('마지막 타가 그쪽이 아니면 from이 없다', () => {
    const flow = tempoFlow(errs(-30, -30, -30, 5));
    expect(flow.kind).toBe('faster');
    expect(flow.from).toBeUndefined();
  });

  it('고름에는 from이 없고 빈 목록도 고름', () => {
    expect('from' in tempoFlow(errs(1, -1, 2, -2))).toBe(false);
    expect(tempoFlow([])).toEqual({ kind: 'steady' });
  });
});

describe('chartScaleMs', () => {
  it('가장 큰 절대 오차를 10 단위로 올리고 40보다 작지 않다', () => {
    expect(chartScaleMs(errs(0, 12, -34))).toBe(40);
    expect(chartScaleMs(errs(0, 41))).toBe(50);
    expect(chartScaleMs(errs(0, 50))).toBe(50);
    expect(chartScaleMs([])).toBe(40);
  });
});

describe('tempoRemark', () => {
  it('흐름별 문구', () => {
    expect(tempoRemark({ kind: 'faster' })).toBe('뒤로 갈수록 빨라졌어요.');
    expect(tempoRemark({ kind: 'slower' })).toBe('뒤로 갈수록 느려졌어요.');
    expect(tempoRemark({ kind: 'steady' })).toBe('끝까지 빠르기를 지켰어요.');
  });
});

describe('flowCell', () => {
  it('고름', () => {
    expect(flowCell({ kind: 'steady' })).toEqual({ value: '고름', note: '마지막 4타가 ±10ms 안이에요' });
  });

  it('from이 있으면 몇 번째부터인지', () => {
    expect(flowCell({ kind: 'faster', from: 5 })).toEqual({ value: '빨라짐', note: '5번째 타격부터' });
  });

  it('from이 없으면 끝으로 갈수록', () => {
    expect(flowCell({ kind: 'slower' })).toEqual({ value: '느려짐', note: '끝으로 갈수록' });
  });
});

describe('formatBpm', () => {
  it('소수 한 자리', () => {
    expect(formatBpm(96)).toBe('96.0');
    expect(formatBpm(96.34)).toBe('96.3');
  });
});

describe('tempoResultTitle', () => {
  it('16타면 평균 오차와 흐름 문구', () => {
    const hits = errs(0, ...Array.from({ length: 15 }, () => 20));
    expect(tempoResultTitle(hits)).toEqual([`평균 ${averageErrorMs(hits)}ms 벗어났어요.`, tempoRemark(tempoFlow(hits))]);
    expect(tempoResultTitle(hits)[0]).toBe('평균 20ms 벗어났어요.');
  });

  it('16타 미만이면 멈춘 자리를 알린다', () => {
    expect(tempoResultTitle(errs(0, 1, 2, 3, 4, 5, 6))).toEqual(['16타를 다 치지 못했어요.', '7타에서 멈췄어요. 스틱 연결을 확인하고 다시 해 보세요.']);
  });

  it('0타도 같은 모양', () => {
    expect(tempoResultTitle([])).toEqual(['16타를 다 치지 못했어요.', '0타에서 멈췄어요. 스틱 연결을 확인하고 다시 해 보세요.']);
  });
});

describe('tempoBestNote', () => {
  it('낮을수록 좋다', () => {
    expect(tempoBestNote(16, null)).toEqual({ newBest: true, text: '첫 기록이에요' });
    expect(tempoBestNote(16, 18)).toEqual({ newBest: true, text: '지난 최고 18ms' });
    expect(tempoBestNote(16, 16)).toEqual({ newBest: false, text: '최고 기록과 같아요' });
    expect(tempoBestNote(16, 14)).toEqual({ newBest: false, text: '최고 기록 14ms' });
  });
});

describe('isTempoDetail', () => {
  const errors = (n: number) => Array.from({ length: n }, (_, i) => i - 3);

  it('bpm과 정수 16개면 참(음수 오차도)', () => {
    expect(isTempoDetail({ bpm: 96, errors: errors(16) })).toBe(true);
    expect(isTempoDetail({ bpm: 40, errors: errors(16) })).toBe(true);
    expect(isTempoDetail({ bpm: 240, errors: errors(16) })).toBe(true);
  });

  it('bpm이 범위 밖·소수·문자열이면 거짓', () => {
    expect(isTempoDetail({ bpm: 39, errors: errors(16) })).toBe(false);
    expect(isTempoDetail({ bpm: 241, errors: errors(16) })).toBe(false);
    expect(isTempoDetail({ bpm: 96.5, errors: errors(16) })).toBe(false);
    expect(isTempoDetail({ bpm: '96', errors: errors(16) })).toBe(false);
  });

  it('errors가 15·17개, 소수, 문자열 섞임이면 거짓', () => {
    expect(isTempoDetail({ bpm: 96, errors: errors(15) })).toBe(false);
    expect(isTempoDetail({ bpm: 96, errors: errors(17) })).toBe(false);
    expect(isTempoDetail({ bpm: 96, errors: [...errors(15), 1.5] })).toBe(false);
    expect(isTempoDetail({ bpm: 96, errors: [...errors(15), '1'] })).toBe(false);
  });

  it('필드가 없거나 객체가 아니면 거짓', () => {
    expect(isTempoDetail({ bpm: 96 })).toBe(false);
    expect(isTempoDetail({ errors: errors(16) })).toBe(false);
    expect(isTempoDetail(null)).toBe(false);
    expect(isTempoDetail(undefined)).toBe(false);
    expect(isTempoDetail('x')).toBe(false);
  });
});
