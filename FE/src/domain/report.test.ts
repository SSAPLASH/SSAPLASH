import { describe, expect, it } from 'vitest';
import { analysisTeaser, isTooShortForAnalysis, isUploadTarget, MIN_NOTES_FOR_ANALYSIS, segmentBars, type AnalysisStatus, type Report, type WeakSegment } from './report';

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
    inputSource: 'KEYBOARD',
    analysisStatus,
    weakSegments,
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
