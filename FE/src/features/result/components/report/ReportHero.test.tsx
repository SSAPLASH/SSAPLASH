// 리포트 머리·하이라이트 렌더 (설계 COACH-002-report-apple-redesign 6장). 정적 마크업으로 검사한다.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CoachSummary } from '@/domain/play/report';
import { judgementSplit } from '@/features/result/domain/reportView';
import { ReportHero } from './ReportHero';
import { ReportHighlights } from './ReportHighlights';

const S: CoachSummary = { level: 'FAIR', text: '기본기는 잘 잡혀 있어요.\n스네어를 신경 써 보세요.', focusPattern: null, source: 'RULE' };
const split = judgementSplit({ PERFECT: 71, GOOD: 19, MISS: 6 }, null);

describe('ReportHero', () => {
  it('총평 첫 문장은 도입 줄(h1 is-lead), 나머지는 아래 본문, 레벨 뱃지', () => {
    const h = renderToStaticMarkup(<ReportHero summary={S} fallbackTitle="연주 리포트" score={87420} accuracy={0.912} split={split} />);
    expect(h).toContain('<h1 class="rp-hero-title is-lead">기본기는 잘 잡혀 있어요.</h1>');
    expect(h).toContain('<p class="rp-hero-rest">스네어를 신경 써 보세요.</p>');
    expect(h).toContain('rp-level tone-good');
    expect(h).not.toContain('연주 리포트');
  });

  it('한 문장 총평이면 도입 줄로 낮추지 않는다', () => {
    const one: CoachSummary = { ...S, text: '기본기는 잘 잡혀 있어요.' };
    const h = renderToStaticMarkup(<ReportHero summary={one} fallbackTitle="" score={1} accuracy={1} split={split} />);
    expect(h).toContain('<h1 class="rp-hero-title">기본기는 잘 잡혀 있어요.</h1>');
    expect(h).not.toContain('rp-hero-rest');
  });

  it('총평이 없으면 곡 이름이 제목', () => {
    const h = renderToStaticMarkup(<ReportHero summary={null} fallbackTitle="기본 8비트 연주 리포트" score={0} accuracy={0} split={split} />);
    expect(h).toContain('<h1 class="rp-hero-title">기본 8비트 연주 리포트</h1>');
    expect(h).not.toContain('코치의 한마디');
  });

  it('점수·정확도와 판정 막대 비율, 노트 전에는 빠름·늦음 줄이 없다', () => {
    const h = renderToStaticMarkup(<ReportHero summary={S} fallbackTitle="" score={87420} accuracy={0.912} split={split} />);
    expect(h).toContain('87,420');
    expect(h).toContain('정확도 91.2%');
    expect(h).toContain('노트 96개 판정');
    expect(h).toContain('width:73.95833333333333%');
    expect(h).not.toContain('rp-split-sub');
  });

  it('노트를 받으면 빠름·늦음 개수를 함께 보인다', () => {
    const s = judgementSplit({ PERFECT: 1, GOOD: 2, MISS: 0 }, [
      { judgement: 'GOOD', deltaMs: -10 },
      { judgement: 'GOOD', deltaMs: 20 },
    ]);
    expect(renderToStaticMarkup(<ReportHero summary={S} fallbackTitle="" score={1} accuracy={1} split={s} />)).toContain('빠름 1 · 늦음 1');
  });
});

describe('ReportHighlights', () => {
  const base = { maxCombo: 48, totalNotes: 96, timing: null, goodMs: 60, durationMs: null, bars: null, recent: null };

  it('데이터가 있는 칸만 그린다', () => {
    const h = renderToStaticMarkup(<ReportHighlights {...base} />);
    expect(h).toContain('최대 콤보');
    expect(h).toContain('전체 96노트의 50%');
    expect(h).not.toContain('평균 박자');
    expect(h).not.toContain('연주 시간');
    expect(h).not.toContain('지난번보다');
    expect(h).toContain('--rp-cells:1');
  });

  it('네 칸: 평균 박자 점·띠 위치, 마디 수, 지난번 대비', () => {
    const h = renderToStaticMarkup(
      <ReportHighlights
        {...base}
        timing={{ meanMs: 12, lowMs: 0, highMs: 24, samples: 50 }}
        durationMs={64000}
        bars={24}
        recent={{ values: [0.84, 0.88, 0.91], diffPoint: 3 }}
      />,
    );
    expect(h).toContain('ms 늦게');
    expect(h).toContain('left:60%');
    expect(h).toContain('left:50%;width:20%');
    expect(h).toContain('1:04');
    expect(h).toContain('24마디');
    expect(h).toContain('+3');
    expect(h).toContain('최근 3번 84% → 91%');
    expect(h).toContain('--rp-cells:4');
  });

  it('지난번보다 낮으면 빼기 부호', () => {
    expect(renderToStaticMarkup(<ReportHighlights {...base} recent={{ values: [0.9, 0.85], diffPoint: -5 }} />)).toContain('−5');
  });
});
