// 쪽 번호 (설계 QA-363-song-list-pager-studio-grid). 「« ‹ 1 … 10 › »」 — 번호는 10개씩 묶어 보이고, ‹ ›는 이전·다음 묶음, « »는 첫·마지막 쪽.
// 보이는 묶음은 현재 쪽을 따라간다(따로 상태를 두지 않는다). 갈 곳이 없는 버튼은 숨기지 않고 비활성으로 둔다.
import { PAGINATION_GROUP, pageGroup } from './paginationGroup';
import './Pagination.css';

export interface PaginationProps {
  /** 현재 쪽(0부터) */
  page: number;
  /** 전체 쪽 수(1 이상) */
  pageCount: number;
  onChange: (page: number) => void;
  /** nav의 접근성 이름. 예) 「곡 목록 쪽」 */
  label: string;
  className?: string;
}

export function Pagination({ page, pageCount, onChange, label, className }: PaginationProps) {
  const [start, end] = pageGroup(page, pageCount);
  const first = start === 0;
  const last = end >= pageCount - 1;
  const nums = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <nav className={['ui-pg', className ?? ''].filter(Boolean).join(' ')} aria-label={label}>
      <button type="button" className="ui-pg-btn" aria-label="첫 쪽" disabled={first} onClick={() => onChange(0)}>
        «
      </button>
      <button type="button" className="ui-pg-btn" aria-label="이전 10쪽" disabled={first} onClick={() => onChange(start - 1)}>
        ‹
      </button>
      {nums.map((i) => (
        <button
          key={i}
          type="button"
          className={`ui-pg-btn${i === page ? ' current' : ''}`}
          aria-current={i === page ? 'page' : undefined}
          onClick={() => onChange(i)}
        >
          {i + 1}
        </button>
      ))}
      <button type="button" className="ui-pg-btn" aria-label="다음 10쪽" disabled={last} onClick={() => onChange(start + PAGINATION_GROUP)}>
        ›
      </button>
      <button type="button" className="ui-pg-btn" aria-label="마지막 쪽" disabled={last} onClick={() => onChange(pageCount - 1)}>
        »
      </button>
    </nav>
  );
}
