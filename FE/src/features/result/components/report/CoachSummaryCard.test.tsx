// 총평 카드 렌더 (COACH-003 설계 6장). 정적 마크업 문자열로 검사한다.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CoachSummary } from '@/domain/play/report';
import { CoachSummaryCard } from './CoachSummaryCard';

const S: CoachSummary = { level: 'FAIR', text: '박자는 안정적이에요.\n스네어를 신경 써 보세요.', focusPattern: null, source: 'RULE' };

describe('CoachSummaryCard', () => {
  it('summary가 null이면 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(<CoachSummaryCard summary={null} />)).toBe('');
  });
  it('제목·레벨 뱃지·AI 캡션·본문', () => {
    const h = renderToStaticMarkup(<CoachSummaryCard summary={S} />);
    expect(h).toContain('코치의 한마디');
    expect(h).toContain('weak-badge tone-good');
    expect(h).toContain('괜찮아요');
    expect(h).toContain('AI가 작성했어요');
    expect(h).toContain('coach-summary-text');
    expect(h).toContain('박자는 안정적이에요.');
  });
  it('레벨별 뱃지 톤', () => {
    expect(renderToStaticMarkup(<CoachSummaryCard summary={{ ...S, level: 'GOOD' }} />)).toContain('tone-perfect');
    expect(renderToStaticMarkup(<CoachSummaryCard summary={{ ...S, level: 'NEEDS_WORK' }} />)).toContain('연습이 필요해요');
  });
  it('모르는 level은 뱃지 없이 본문만', () => {
    const h = renderToStaticMarkup(<CoachSummaryCard summary={{ ...S, level: 'SOMETHING' }} />);
    expect(h).not.toContain('weak-badge');
    expect(h).toContain('박자는 안정적이에요.');
  });
});
