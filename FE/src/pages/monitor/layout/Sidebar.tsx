// 단계 사이드바. 항목마다 상태 점과 이유 툴팁을 달고, 좁은 화면(<900px)에서는 위쪽 가로 스크롤 칩이 된다.
import { memo } from 'react';
import { LEVEL_LABEL, sectionLevel, sectionReason, SECTION_ITEMS, type Section, type StageHealthMap } from './sections';

export const Sidebar = memo(function Sidebar({
  current,
  onSelect,
  health,
}: {
  current: Section;
  onSelect: (s: Section) => void;
  health: StageHealthMap;
}) {
  return (
    <nav className="mon-side" aria-label="모니터 단계">
      {SECTION_ITEMS.map((it) => {
        const hasDot = it.key !== 'control' && it.key !== 'overview';
        const level = sectionLevel(it.key, health);
        const reason = sectionReason(it.key, health);
        return (
          <button
            key={it.key}
            className={`mon-side-item${current === it.key ? ' active' : ''}${it.divider ? ' divider' : ''}`}
            aria-current={current === it.key ? 'page' : undefined}
            title={reason ? `${LEVEL_LABEL[level]} — ${reason}` : undefined}
            onClick={() => onSelect(it.key)}
          >
            {hasDot && <span className={`mon-dot ${level}`} role="img" aria-label={LEVEL_LABEL[level]} />}
            {it.label}
          </button>
        );
      })}
    </nav>
  );
});
