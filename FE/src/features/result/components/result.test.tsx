import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeedbackCard } from './FeedbackCard';
import { JudgeBars } from './JudgeBars';
import { PadSummaryTable } from './PadSummaryTable';
import { ResultSummaryCard } from './ResultSummaryCard';
import type { FeedbackItem, PadSummary } from '@/features/result/domain/feedback';

describe('ResultSummaryCard', () => {
  it('scoreText가 없으면 점수 블록을 그리지 않는다', () => {
    const html = renderToStaticMarkup(<ResultSummaryCard title="곡" meta="메타" accuracyText="96.8%" />);
    expect(html).not.toContain('점수 / 최고 콤보');
    expect(html).toContain('정확도');
  });

  it('scoreText가 있으면 점수 블록을 그린다', () => {
    const html = renderToStaticMarkup(<ResultSummaryCard title="곡" meta="메타" scoreText="92,400 / 64" accuracyText="96.8%" />);
    expect(html).toContain('점수 / 최고 콤보');
    expect(html).toContain('92,400 / 64');
  });

  it('제목·메타·정확도 텍스트를 그린다', () => {
    const html = renderToStaticMarkup(<ResultSummaryCard title="내 곡" meta="밴드 · 120 BPM" accuracyText="75.0%" />);
    expect(html).toContain('>내 곡<');
    expect(html).toContain('밴드 · 120 BPM');
    expect(html).toContain('75.0%');
  });

  it('titleBadge를 제목 옆에 그린다', () => {
    const html = renderToStaticMarkup(
      <ResultSummaryCard title="곡" meta="m" accuracyText="1%" titleBadge={<span className="badge-x">삭제된 곡</span>} />,
    );
    expect(html).toContain('badge-x');
    expect(html.indexOf('<h1')).toBeLessThan(html.indexOf('badge-x'));
  });

  it('점수가 있으면 지표 묶음이 [점수 | 세로선 | 정확도] 순서다', () => {
    const html = renderToStaticMarkup(<ResultSummaryCard title="곡" meta="m" scoreText="92,400 / 64" accuracyText="96.8%" />);
    const metrics = html.slice(html.indexOf('result-summary-metrics'));
    expect(metrics.indexOf('result-summary-score')).toBeGreaterThan(-1);
    expect(metrics.indexOf('result-summary-score')).toBeLessThan(metrics.indexOf('result-summary-divider'));
    expect(metrics.indexOf('result-summary-divider')).toBeLessThan(metrics.indexOf('result-summary-accuracy'));
    expect(html.indexOf('result-summary-song')).toBeLessThan(html.indexOf('result-summary-metrics'));
  });

  it('점수가 없으면(악보 모드) 세로선 없이 정확도만 묶음에 있다', () => {
    const html = renderToStaticMarkup(<ResultSummaryCard title="곡" meta="m" accuracyText="96.8%" />);
    expect(html).toContain('result-summary-metrics');
    expect(html).not.toContain('result-summary-divider');
    expect(html).not.toContain('result-summary-score');
  });

  it('titleBadge가 없으면 칩이 없다', () => {
    expect(renderToStaticMarkup(<ResultSummaryCard title="곡" meta="m" accuracyText="1%" />)).not.toContain('badge-x');
  });
});

describe('JudgeBars', () => {
  const widths = (html: string) => [...html.matchAll(/width:([^;"]+)/g)].map((m) => m[1]);

  it('막대 폭은 개수 / 총합 비율', () => {
    const html = renderToStaticMarkup(<JudgeBars counts={{ PERFECT: 5, GOOD: 3, MISS: 2 }} />);
    expect(widths(html)).toEqual(['50%', '30%', '20%']);
    expect(html).toContain('총 10회');
  });

  it('총합이 0이면 모든 막대 폭 0', () => {
    const html = renderToStaticMarkup(<JudgeBars counts={{ PERFECT: 0, GOOD: 0, MISS: 0 }} />);
    expect(widths(html)).toEqual(['0', '0', '0']);
    expect(html).not.toContain('NaN');
  });

  it('채보 외 타격이 0이거나 없으면 캡션이 없다', () => {
    expect(renderToStaticMarkup(<JudgeBars counts={{ PERFECT: 1, GOOD: 0, MISS: 0 }} />)).not.toContain('채보 외 타격');
    expect(renderToStaticMarkup(<JudgeBars counts={{ PERFECT: 1, GOOD: 0, MISS: 0 }} strayHits={0} />)).not.toContain('채보 외 타격');
  });

  it('채보 외 타격이 있으면 캡션을 그린다', () => {
    expect(renderToStaticMarkup(<JudgeBars counts={{ PERFECT: 1, GOOD: 0, MISS: 0 }} strayHits={4} />)).toContain('채보 외 타격 4회');
  });
});

describe('PadSummaryTable', () => {
  const rows: PadSummary[] = [
    { pad: 'SNARE', total: 12, perfect: 8, good: 3, miss: 1, meanDeltaMs: -12.4, accuracy: 0.9, meanVelocity: 72 },
    { pad: 'KICK', total: 4, perfect: 4, good: 0, miss: 0, meanDeltaMs: null, accuracy: 1, meanVelocity: null },
  ];

  it('열 5개(패드·타격 수·정확도·평균 세기·평균 타이밍)', () => {
    const html = renderToStaticMarkup(<PadSummaryTable summary={rows} />);
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(head.match(/<th /g)).toHaveLength(5);
    for (const t of ['패드', '타격 수', '정확도', '평균 세기', '평균 타이밍']) expect(head).toContain(`>${t}<`);
  });

  it('평균 타이밍 칸(머리글·각 행)에 숨김용 클래스가 붙는다', () => {
    const html = renderToStaticMarkup(<PadSummaryTable summary={rows} />);
    expect(html.match(/result-col-timing/g)).toHaveLength(1 + rows.length);
  });

  it('값 표기: 회수·정확도 1자리·세기·Δ', () => {
    const html = renderToStaticMarkup(<PadSummaryTable summary={rows} />);
    expect(html).toContain('스네어');
    expect(html).toContain('12회');
    expect(html).toContain('90.0%');
    expect(html).toContain('72 / 100');
    expect(html).toContain('−12ms');
  });

  it('meanVelocity·meanDeltaMs가 null이면 「—」', () => {
    const html = renderToStaticMarkup(<PadSummaryTable summary={[rows[1]]} />);
    expect(html.match(/>—</g)).toHaveLength(2);
    expect(html).not.toContain('/ 100');
  });

  it('양수 Δ는 + 부호', () => {
    const html = renderToStaticMarkup(<PadSummaryTable summary={[{ ...rows[0], meanDeltaMs: 8 }]} />);
    expect(html).toContain('+8ms');
  });
});

describe('FeedbackCard', () => {
  const item: FeedbackItem = { id: 'pad-miss', title: '스네어를 자주 놓쳐요', body: '12개 중 4개를 놓쳤어요.', suggestion: '느리게 반복해 보세요.', bars: [1, 3] };

  it('bars와 핸들러가 있으면 button(aria-pressed)', () => {
    const html = renderToStaticMarkup(<FeedbackCard item={item} onFocusBars={() => {}} />);
    expect(html).toMatch(/^<button/);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('result-fb-click');
  });

  it('active면 active 클래스와 aria-pressed true', () => {
    const html = renderToStaticMarkup(<FeedbackCard item={item} onFocusBars={() => {}} active />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('active');
  });

  it('핸들러가 없으면 div', () => {
    const html = renderToStaticMarkup(<FeedbackCard item={item} />);
    expect(html).toMatch(/^<div/);
    expect(html).not.toContain('<button');
  });

  it('bars가 없으면 핸들러가 있어도 div', () => {
    const html = renderToStaticMarkup(<FeedbackCard item={{ ...item, bars: undefined }} onFocusBars={() => {}} />);
    expect(html).toMatch(/^<div/);
  });

  it('제목·설명·suggestion 줄을 그린다', () => {
    const html = renderToStaticMarkup(<FeedbackCard item={item} />);
    expect(html).toContain('스네어를 자주 놓쳐요');
    expect(html).toContain('12개 중 4개를 놓쳤어요.');
    expect(html).toContain('느리게 반복해 보세요.');
  });

  it('suggestion이 비면 그 줄을 그리지 않는다', () => {
    const html = renderToStaticMarkup(<FeedbackCard item={{ ...item, suggestion: '' }} />);
    expect(html.match(/result-fb-desc/g)).toHaveLength(1);
  });
});

it('하이햇 행에만 열린 노트 결과와 접근 가능한 설명을 넣는다', () => {
  const row: PadSummary = { pad: 'HIHAT', total: 1, perfect: 1, good: 0, miss: 0, meanDeltaMs: 0, accuracy: 1, meanVelocity: 80 };
  const html = renderToStaticMarkup(<PadSummaryTable summary={[row]} openHihat={{ text: '열린 1/2', label: '열린 하이햇 성공 1개, 전체 2개' }} />);
  expect(html).toContain('열린 1/2'); expect(html).toContain('aria-label="열린 하이햇 성공 1개, 전체 2개"');
});

describe('ResultSummaryCard 최고 기록 칩·카운트업', () => {
  it('칩이 없으면 그리지 않는다', () => {
    expect(renderToStaticMarkup(<ResultSummaryCard title="곡" meta="m" accuracyText="1%" recordBadge={null} />)).not.toContain('result-record-chip');
  });
  it('첫 기록·갱신 칩은 종류와 문구를 그린다', () => {
    const first = renderToStaticMarkup(<ResultSummaryCard title="곡" meta="m" accuracyText="1%" recordBadge={{ kind: 'first', text: '첫 기록' }} />);
    expect(first).toContain('data-kind="first"');
    expect(first).toContain('첫 기록');
    const up = renderToStaticMarkup(<ResultSummaryCard title="곡" meta="m" accuracyText="1%" recordBadge={{ kind: 'new', text: '최고 기록 갱신 · 이전 1 → 현재 2' }} />);
    expect(up).toContain('data-kind="new"');
    expect(up).toContain('최고 기록 갱신 · 이전 1 → 현재 2');
  });
  it('카운트업이 있어도 처음 마크업은 최종 글자다(보간은 마운트 뒤 DOM에서)', () => {
    const html = renderToStaticMarkup(
      <ResultSummaryCard
        title="곡"
        meta="m"
        scoreText="1,000 / 10"
        accuracyText="96.8%"
        countUp={{ score: (p) => `${Math.round(1000 * p).toLocaleString('ko-KR')} / ${Math.round(10 * p)}`, accuracy: (p) => `${(96.8 * p).toFixed(1)}%` }}
      />,
    );
    expect(html).toContain('>1,000 / 10<');
    expect(html).toContain('>96.8%<');
  });
  it('축하 슬롯을 카드 안에 그린다', () => {
    const html = renderToStaticMarkup(<ResultSummaryCard title="곡" meta="m" accuracyText="1%" celebration={<i className="slot-x" />} />);
    expect(html).toContain('slot-x');
  });
});
