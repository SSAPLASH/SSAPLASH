import { describe, expect, it } from 'vitest';
import { analysisTeaser, formatClock, isTooShortForAnalysis, isUploadTarget, levelBadge, MIN_NOTES_FOR_ANALYSIS, segmentBars, segmentLevel, segmentRangeText, summaryBadge, type AnalysisStatus, type Report, type WeakSegment } from './report';

describe('segmentBars', () => {
  it('bpm 120·4박에서 7000~12000ms는 [3, 5]', () => {
    expect(segmentBars(7000, 12000, 120, 4)).toEqual([3, 5]);
  });

  it('bpm이 0이거나 박자가 0이면 null', () => {
    expect(segmentBars(7000, 12000, 0, 4)).toBeNull();
    expect(segmentBars(7000, 12000, 120, 0)).toBeNull();
    expect(segmentBars(7000, 12000, Number.NaN, 4)).toBeNull();
  });

  it('마디 경계는 feedback의 barOf와 같게 (t+1)로 센다', () => {
    expect(segmentBars(0, 1, 120, 4)).toEqual([0, 0]);
    expect(segmentBars(1999, 2000, 120, 4)).toEqual([1, 1]);
  });

  it('격자 원점을 주면 원점을 뺀 시각으로 센다(원점 500: 12500~18500 = 7~9마디)', () => {
    expect(segmentBars(12500, 18500, 120, 4, 500)).toEqual([6, 8]);
    expect(segmentBars(12000, 18000, 120, 4)).toEqual([6, 8]);
    expect(segmentBars(12500, 17500, 120, 4)).toEqual([6, 8]);
    expect(segmentBars(4000, 6000, 120, 4)).toEqual([2, 2]);
    // 원점보다 앞(리드인)은 첫 마디로 센다
    expect(segmentBars(0, 400, 120, 4, 500)).toEqual([0, 0]);
    expect(segmentBars(4000, 6000, 120, 4, Number.NaN)).toEqual([2, 2]);
  });
});

describe('isTooShortForAnalysis', () => {
  it('판정 합 19는 짧고 20은 아니다', () => {
    expect(MIN_NOTES_FOR_ANALYSIS).toBe(20);
    expect(isTooShortForAnalysis({ PERFECT: 10, GOOD: 5, MISS: 4 })).toBe(true);
    expect(isTooShortForAnalysis({ PERFECT: 10, GOOD: 5, MISS: 5 })).toBe(false);
  });
});

const seg: WeakSegment = {
  fromMs: 0,
  toMs: 1000,
  pattern: 'TIMING_LATE',
  description: '늦게 칩니다',
  causeTags: [],
  pads: [],
  severity: 0.5,
  scope: 'SEGMENT',
  metrics: {},
};

function makeReport(analysisStatus: AnalysisStatus, weakSegments: WeakSegment[] | null, total = 40): Report {
  return {
    playId: 'p',
    score: 0,
    accuracy: 1,
    maxCombo: 0,
    counts: { PERFECT: total, GOOD: 0, MISS: 0 },
    histogram: null,
    padStats: [],
    mode: 'SHEET',
    songId: null,
    chartId: null,
    difficulty: null,
    inputSource: 'KEYBOARD', playbackRate: 1,
    analysisStatus,
    weakSegments,
    coachSummary: null,
    recommendedDrills: null,
    generatedAt: '2026-10-28T00:00:00Z',
  };
}

describe('analysisTeaser', () => {
  const failed = 'AI 분석은 만들지 못했어요 · 패드별 정확도·타이밍은 볼 수 있어요';

  it('리포트가 없거나 로딩 중이면 null', () => {
    expect(analysisTeaser(null)).toBeNull();
  });
  it('PENDING', () => {
    expect(analysisTeaser(makeReport('PENDING', null))).toBe('AI가 연주를 분석하고 있어요');
  });
  it('DONE + 1개 이상은 개수를 보여 준다', () => {
    expect(analysisTeaser(makeReport('DONE', [seg, seg]))).toBe('AI가 약점 2곳을 찾았어요');
  });
  it('DONE + 빈 배열 + 충분한 길이는 약점 없음', () => {
    expect(analysisTeaser(makeReport('DONE', [], 20))).toBe('AI 분석 완료 · 뚜렷한 약점 없음');
  });
  it('DONE + 빈 배열 + 짧은 곡', () => {
    expect(analysisTeaser(makeReport('DONE', [], 19))).toBe('곡이 짧아 분석하지 않았어요');
  });
  it('DONE + null은 FAILED와 같이 취급', () => {
    expect(analysisTeaser(makeReport('DONE', null))).toBe(failed);
  });
  it('FAILED', () => {
    expect(analysisTeaser(makeReport('FAILED', null))).toBe(failed);
  });
  it('NOT_REQUESTED는 null(기존 설명 유지)', () => {
    expect(analysisTeaser(makeReport('NOT_REQUESTED', null))).toBeNull();
  });
});

describe('isUploadTarget', () => {
  const st = (status: string, retryable = false) => ({ status, retryable });
  it('이전 형식 로그는 대상이 아니다', () => {
    expect(isUploadTarget(true, st('DONE'))).toBe(false);
  });
  it('업로드 시작 전(상태 없음)·진행 중·완료는 대상이다', () => {
    expect(isUploadTarget(false, undefined)).toBe(true);
    expect(isUploadTarget(false, st('UPLOADING'))).toBe(true);
    expect(isUploadTarget(false, st('DONE'))).toBe(true);
  });
  it('SKIPPED는 대상이 아니다', () => {
    expect(isUploadTarget(false, st('SKIPPED'))).toBe(false);
  });
  it('FAILED는 재시도 가능이면 대상, 불가면 아니다', () => {
    expect(isUploadTarget(false, st('FAILED', true))).toBe(true);
    expect(isUploadTarget(false, st('FAILED', false))).toBe(false);
  });
});

describe('segmentLevel', () => {
  it('severityLevel이 있으면 severity와 무관하게 그대로', () => {
    expect(segmentLevel({ ...seg, severity: 0.9, severityLevel: 'LOW' })).toBe('LOW');
    expect(segmentLevel({ ...seg, severity: 0.1, severityLevel: 'MEDIUM' })).toBe('MEDIUM');
  });

  it('없으면 severity 0.7 이상 HIGH, 미만 LOW', () => {
    expect(segmentLevel({ ...seg, severity: 0.8 })).toBe('HIGH');
    expect(segmentLevel({ ...seg, severity: 0.7 })).toBe('HIGH');
    expect(segmentLevel({ ...seg, severity: 0.69 })).toBe('LOW');
  });
});

describe('levelBadge', () => {
  it('HIGH 주의(miss), MEDIUM 보통(warn), LOW 없음', () => {
    expect(levelBadge('HIGH')).toEqual({ text: '주의', tone: 'miss' });
    expect(levelBadge('MEDIUM')).toEqual({ text: '보통', tone: 'warn' });
    expect(levelBadge('LOW')).toBeNull();
  });
});

describe('summaryBadge', () => {
  it('세 값을 문구·톤으로, 모르는 값은 null', () => {
    expect(summaryBadge('GOOD')).toEqual({ text: '좋아요', tone: 'perfect' });
    expect(summaryBadge('FAIR')).toEqual({ text: '괜찮아요', tone: 'good' });
    expect(summaryBadge('NEEDS_WORK')).toEqual({ text: '연습이 필요해요', tone: 'miss' });
    expect(summaryBadge('EXCELLENT')).toBeNull();
    expect(summaryBadge('')).toBeNull();
  });
});

describe('formatClock', () => {
  it('초는 내림, 음수·NaN은 0:00', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(7000)).toBe('0:07');
    expect(formatClock(12000)).toBe('0:12');
    expect(formatClock(65000)).toBe('1:05');
    expect(formatClock(59999)).toBe('0:59');
    expect(formatClock(-1)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });
});

describe('segmentRangeText', () => {
  const s: WeakSegment = { ...seg, fromMs: 7000, toMs: 12000 };

  it('마디가 있으면 마디 + 시계, 같은 마디는 한 마디만', () => {
    expect(segmentRangeText(s, segmentBars(7000, 12000, 120, 4), 32000)).toBe('4~6마디 · 0:07 – 0:12');
    expect(segmentRangeText(s, [1, 1], null)).toBe('2마디 · 0:07 – 0:12');
  });

  it('마디가 없으면 시계만', () => {
    expect(segmentRangeText(s, null, 32000)).toBe('0:07 – 0:12');
  });

  it('WHOLE은 곡 전체 · 0:00 – 곡 길이(없으면 toMs)', () => {
    const whole: WeakSegment = { ...seg, scope: 'WHOLE', fromMs: 0, toMs: 32000 };
    expect(segmentRangeText(whole, null, 32000)).toBe('곡 전체 · 0:00 – 0:32');
    expect(segmentRangeText(whole, null, null)).toBe('곡 전체 · 0:00 – 0:32');
  });
});
