// WeakSegments 상태별 렌더 (COACH-003 4-1·4-2). @testing-library 없이 정적 마크업 문자열로 검사한다.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AnalysisStatus, ReportNote, WeakSegment } from '@/domain/report';
import type { UseSegmentPlayer } from './useSegmentPlayer';
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

const NOTES: ReportNote[] = [];
const PLAYER: UseSegmentPlayer = {
  playingKey: null,
  rate: 1,
  loop: false,
  play: () => {},
  stop: () => {},
  toggleRate: () => {},
  toggleLoop: () => {},
};
const PLAYBACK: WeakSegmentsProps['playback'] = { notes: NOTES, durationMs: 32000, accompanimentUrl: null };

function render(over: Partial<WeakSegmentsProps> & { status: AnalysisStatus }): string {
  return renderToStaticMarkup(
    <WeakSegments segments={null} counts={BIG} bars={null} polling="idle" playback={PLAYBACK} player={PLAYER} onRefresh={() => {}} {...over} />,
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
  it('WHOLE 카드가 먼저, 「연주 전체」 머리 줄·칩 없음·「전체 재생」, 0.67은 뱃지 없음', () => {
    const h = render({ status: 'DONE', segments: [SEG, WHOLE] });
    expect(h.indexOf('전체적으로 평균 22ms')).toBeGreaterThan(-1);
    expect(h.indexOf('전체적으로 평균 22ms')).toBeLessThan(h.indexOf('7~12초 구간에서'));
    expect(h).toContain('연주 전체</strong>');
    expect(h).toContain('전체 재생');
    expect(h).toContain('처음부터 재생');
    expect(h).not.toContain('하이햇');
    expect(h).toContain('스네어');
    expect(h).not.toContain('weak-badge');
    expect(h).toContain('weak-card level-low');
    expect(h).not.toContain('7~12초</strong>');
  });
  it('severityLevel 없이 severity 0.8은 주의 뱃지와 high 강조', () => {
    const h = render({ status: 'DONE', segments: [{ ...SEG, severity: 0.8 }] });
    expect(h).toContain('주의');
    expect(h).toContain('tone-miss');
    expect(h).toContain('weak-card level-high');
  });
  it('severityLevel MEDIUM은 보통 뱃지, HIGH는 주의, LOW는 뱃지 없음(severity보다 우선)', () => {
    const m = render({ status: 'DONE', segments: [{ ...SEG, severityLevel: 'MEDIUM' }] });
    expect(m).toContain('보통');
    expect(m).toContain('tone-warn');
    expect(m).toContain('level-medium');
    expect(render({ status: 'DONE', segments: [{ ...SEG, severityLevel: 'HIGH' }] })).toContain('주의');
    const low = render({ status: 'DONE', segments: [{ ...SEG, severity: 0.9, severityLevel: 'LOW' }] });
    expect(low).not.toContain('weak-badge');
  });
  it('detail이 있을 때만 상세 줄', () => {
    expect(render({ status: 'DONE', segments: [{ ...SEG, detail: '스네어가 자꾸 빨라요.' }] })).toContain(
      'weak-detail">스네어가 자꾸 빨라요.',
    );
    expect(render({ status: 'DONE', segments: [SEG] })).not.toContain('weak-detail');
  });
  it('패널 구간 문구와 막대 위치', () => {
    const h = render({ status: 'DONE', segments: [SEG], bars: { bpm: 120, beatsPerBar: 4 } });
    expect(h).toContain('4~6마디 · 0:07 – 0:12');
    expect(h).toContain('left:21.875%');
    expect(h).toContain('width:15.625%');
    expect(h).toContain('구간 재생');
    expect(h).not.toContain('disabled');
  });
  it('마디가 없으면 시계만, WHOLE 막대는 전체', () => {
    const h = render({ status: 'DONE', segments: [WHOLE, SEG] });
    expect(h).toContain('곡 전체 · 0:00 – 0:32');
    expect(h).toContain('left:0%;width:100%');
    expect(h).toContain('>0:07 – 0:12<');
  });
  it('노트가 null이면 재생 버튼 비활성', () => {
    const h = render({ status: 'DONE', segments: [SEG], playback: { ...PLAYBACK, notes: null } });
    expect(h).toContain('disabled');
  });
  it('재생 중인 카드는 정지 버튼, 0.75×·반복은 aria-pressed', () => {
    const key = 'SEGMENT:7000:12000:0';
    const h = render({ status: 'DONE', segments: [SEG], player: { ...PLAYER, playingKey: key, rate: 0.75, loop: true } });
    expect(h).toContain('정지');
    expect(h).toContain('aria-pressed="true"');
    expect(h).toContain('active');
    expect(render({ status: 'DONE', segments: [SEG] })).toContain('aria-pressed="false"');
  });
  it('bpm 120·4박, 7000~12000ms → 4~6마디가 머리 줄에 보인다', () => {
    const h = render({ status: 'DONE', segments: [SEG], bars: { bpm: 120, beatsPerBar: 4 } });
    expect(h).toContain('4~6마디</strong>');
    expect(h).not.toContain('7~12초</strong>');
  });
  it('bars가 null이면 마디 텍스트가 없다', () => {
    const h = render({ status: 'DONE', segments: [SEG], bars: null });
    expect(h).not.toContain('마디');
  });
  it('같은 마디면 한 마디만 쓴다', () => {
    const h = render({
      status: 'DONE',
      segments: [{ ...SEG, fromMs: 2100, toMs: 3900 }],
      bars: { bpm: 120, beatsPerBar: 4 },
    });
    expect(h).toContain('2마디</strong>');
  });
  it('tip이 있으면 연습 방법 라벨과 문구가 보이고, 없으면 연습 방법이 없다', () => {
    const withTip = render({ status: 'DONE', segments: [{ ...SEG, tip: '느린 템포로 반복해 보세요.' }] });
    expect(withTip).toContain('weak-tip');
    expect(withTip).toContain('연습 방법');
    expect(withTip).toContain('느린 템포로 반복해 보세요.');
    const noTip = render({ status: 'DONE', segments: [SEG] });
    expect(noTip).not.toContain('연습 방법');
    expect(noTip).not.toContain('weak-tip');
  });
  it('마디 없는 구간은 머리 줄에 칩만, WHOLE은 칩 없이 연주 전체', () => {
    const h = render({ status: 'DONE', segments: [SEG] });
    const head = h.slice(h.indexOf('weak-head'), h.indexOf('weak-desc'));
    expect(head).not.toContain('<strong');
    expect(head).toContain('스네어');
    const w = render({ status: 'DONE', segments: [{ ...WHOLE, tip: '조언이에요.' }] });
    expect(w).toContain('조언이에요.');
  });
  it('모르는 pattern도 description을 표시한다', () => {
    const h = render({
      status: 'DONE',
      segments: [{ ...SEG, pattern: 'SOMETHING_NEW', description: '새로운 유형의 설명이에요.' }],
    });
    expect(h).toContain('새로운 유형의 설명이에요.');
  });
});
