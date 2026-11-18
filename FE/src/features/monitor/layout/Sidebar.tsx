// 단계 사이드바. 항목마다 상태 점과 이유 툴팁을 달고, 좁은 화면(<900px)에서는 위쪽 가로 스크롤 칩이 된다.
import { memo } from 'react';
import { hitIdLabel } from '@/features/monitor/core/feed';
import type { TraceSummary } from '@/features/monitor/core/recording/traceIndex';
import { fmt, stickName } from '@/features/monitor/monitorTypes';
import { LEVEL_LABEL, sectionLevel, sectionReason, SECTION_ITEMS, type Section, type StageHealthMap } from './sections';

export const Sidebar = memo(function Sidebar({
  current,
  onSelect,
  health,
  selected,
  onOpenTrace,
}: {
  current: Section;
  onSelect: (s: Section) => void;
  health: StageHealthMap;
  /** 선택한 타격 요약. 없으면 카드를 숨긴다. 기록에서 밀렸으면 summary가 null */
  selected?: { summary: TraceSummary | null } | null;
  onOpenTrace?: () => void;
}) {
  return (
    <nav className="mon-side" aria-label="모니터 단계">
      {SECTION_ITEMS.map((it) => {
        const hasDot = it.key !== 'control' && it.key !== 'overview' && it.key !== 'trace' && it.key !== 'free';
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
      {selected && (
        <button className="mon-side-sel" title="타격 추적으로 이동" onClick={onOpenTrace}>
          <div className="mon-side-sel-title">선택한 타격</div>
          {selected.summary ? (
            <>
              <strong>{stickName(selected.summary.stick)}</strong>{' '}
              {selected.summary.seq === null ? `hitId ${selected.summary.hitId === null ? '–' : hitIdLabel(selected.summary.hitId)}` : `seq ${selected.summary.seq}`} ·{' '}
              {selected.summary.pad ?? '–'} · {selected.summary.judge}
              <div className="faint">수신 {fmt(selected.summary.t, 0)}ms</div>
            </>
          ) : (
            <span className="faint">기록에서 밀림</span>
          )}
        </button>
      )}
    </nav>
  );
});
