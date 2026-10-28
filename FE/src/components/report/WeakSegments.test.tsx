// WeakSegments 상태별 렌더 (COACH-003 4-1·4-2). @testing-library 없이 정적 마크업 문자열로 검사한다.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AnalysisStatus, WeakSegment } from '@/domain/report';
import { WeakSegments, type WeakSegmentsProps } from './WeakSegments';

const WHOLE: WeakSegment = {
  fromMs: 2000,
  toMs: 14501,
  pattern: 'TIMING_LATE',
  description: '전체적으로 평균 22ms 늦게 치고 있어요.',
  causeTags: ['LATE', 'OVERALL'],
  pads: ['HIHAT', 'SNARE'],
  severity: 0.36,
  scope: 'WHOLE',
  metrics: {},
};
const SEG: WeakSegment = {
  fromMs: 7000,
  toMs: 12000,
  pattern: 'MISS_CLUSTER',
  description: '7~12초 구간에서 노트의 40%를 놓쳤어요.',
  causeTags: ['MISS', 'CLUSTER'],
  pads: ['SNARE'],
  severity: 0.67,
  scope: 'SEGMENT',
  metrics: {},
};

const BIG = { PERFECT: 20, GOOD: 5, MISS: 2 };
const SMALL = { PERFECT: 10, GOOD: 5, MISS: 4 };

function render(over: Partial<WeakSegmentsProps> & { status: AnalysisStatus }): string {
  return renderToStaticMarkup(
    <WeakSegments segments={null} counts={BIG} bars={null} polling="idle" onRefresh={() => {}} {...over} />,
  );
}

describe('WeakSegments 상태 안내', () => {
  it('PENDING + polling', () => {
    const h = render({ status: 'PENDING', polling: 'polling' });
    expect(h).toContain('AI 약점 분석');
    expect(h).toContain('AI가 연주를 분석하고 있어요');
    expect(h).not.toContain('새로고침');
  });
  it('PENDING + exhausted는 새로고침 버튼', () => {
    const h = render({ status: 'PENDING', polling: 'exhausted' });
    expect(h).toContain('아직 분석 중이에요. 잠시 뒤 다시 확인해 주세요');
    expect(h).toContain('<button');
    expect(h).toContain('새로고침');
  });
  it('DONE + 1개 이상은 목록', () => {
    expect(render({ status: 'DONE', segments: [SEG] })).toContain('weak-card');
  });
  it('DONE + 빈 배열: 판정 합 20 이상', () => {
    expect(render({ status: 'DONE', segments: [], counts: BIG })).toContain('뚜렷한 약점이 발견되지 않았어요');
  });
  it('DONE + 빈 배열: 판정 합 20 미만', () => {
    expect(render({ status: 'DONE', segments: [], counts: SMALL })).toContain('곡이 짧아 분석하지 않았어요');
  });
  it('DONE + null은 오류 톤', () => {
    const h = render({ status: 'DONE', segments: null });
    expect(h).toContain('분석 결과가 없어요');
    expect(h).toContain('notice error');
  });
  it('FAILED는 오류 톤', () => {
    const h = render({ status: 'FAILED' });
    expect(h).toContain('이번 연주의 AI 분석을 만들지 못했어요');
    expect(h).toContain('notice error');
  });
  it('NOT_REQUESTED', () => {
    expect(render({ status: 'NOT_REQUESTED' })).toContain('이 연주는 AI 분석 대상이 아니에요');
  });
});

describe('WeakSegments 목록', () => {
  it('샘플 A: WHOLE 카드가 먼저, 구간 카드는 7~12초·스네어 칩, 0.67은 비강조', () => {
    const h = render({ status: 'DONE', segments: [SEG, WHOLE] });
    expect(h.indexOf('연주 전체')).toBeGreaterThan(-1);
    expect(h.indexOf('연주 전체')).toBeLessThan(h.indexOf('7~12초</strong>'));
    expect(h).toContain('전체적으로 평균 22ms 늦게 치고 있어요.');
    expect(h).toContain('7~12초 구간에서 노트의 40%를 놓쳤어요.');
    expect(h).toContain('스네어');
    expect(h).not.toContain('주의');
    expect(h).not.toContain('weak-card severe');
    expect(h).not.toContain('마디');
  });
  it('severity 0.8은 주의 뱃지와 강조', () => {
    const h = render({ status: 'DONE', segments: [{ ...SEG, severity: 0.8 }] });
    expect(h).toContain('주의');
    expect(h).toContain('weak-card severe');
  });
  it('악보 모드는 마디를 병기한다(bpm 100·4박, 7000~12000ms → 3~5마디)', () => {
    const h = render({ status: 'DONE', segments: [SEG], bars: { bpm: 100, beatsPerBar: 4 } });
    expect(h).toContain('7~12초 · 3~5마디');
  });
  it('같은 마디면 한 마디만 쓴다', () => {
    const h = render({
      status: 'DONE',
      segments: [{ ...SEG, fromMs: 2100, toMs: 3900 }],
      bars: { bpm: 120, beatsPerBar: 4 },
    });
    expect(h).toContain('2~4초 · 2마디');
  });
  it('모르는 pattern도 description을 표시한다', () => {
    const h = render({
      status: 'DONE',
      segments: [{ ...SEG, pattern: 'SOMETHING_NEW', description: '새로운 유형의 설명이에요.' }],
    });
    expect(h).toContain('새로운 유형의 설명이에요.');
  });
});
