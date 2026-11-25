// 미니게임 목록 카드 (설계 MODE-006-minigame-list-ui D6). 카드 전체가 게임을 고르는 버튼이다 — 누르면 고르고, 두 번 누르면 바로 시작한다.
// 시작 버튼은 카드에 없다(큰 카드 MiniHero에 하나). 그림은 부품으로 받는다. 버튼 안이라 이름·규칙은 제목 요소가 아니다.
import type { ReactNode } from 'react';
import { formatMiniScore, type MiniGameInfo } from '@/features/mini/domain/miniCatalog';
import type { MiniRecord } from '@/features/mini/domain/miniRecord';

interface Props {
  info: MiniGameInfo;
  /** 보일 최고 기록. 없으면 「아직 기록이 없어요」 */
  record: MiniRecord | null;
  /** 첫 갈래가 아닌 기록일 때만 값 뒤에 붙는 갈래 이름 */
  variantName?: string;
  art: ReactNode;
  /** 지금 고른 게임의 카드인가 */
  selected: boolean;
  onSelect: () => void;
  /** 두 번 눌렀을 때(바로 시작). 곡 표의 더블클릭과 같은 지름길이다 */
  onOpen: () => void;
}

export function MiniCard({ info, record, variantName, art, selected, onSelect, onOpen }: Props) {
  return (
    <button
      type="button"
      className={selected ? 'mini-card is-selected' : 'mini-card'}
      data-game={info.id}
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <span className="mini-card-art">
        {art}
        <span className="mini-card-tag">{info.tag}</span>
      </span>
      <span className="mini-card-text">
        <span className="mini-card-name">{info.name}</span>
        <span className="mini-card-rule">{info.rule}</span>
      </span>
      <span className="mini-card-best">
        <span className="mini-card-label">최고 기록</span>
        {record ? (
          <span className="mini-card-value">
            {formatMiniScore(info, record.score)}
            <span className="mini-card-unit">{info.unit}</span>
            {variantName ? <span className="mini-card-variant">{variantName}</span> : null}
          </span>
        ) : (
          <span className="mini-card-empty">아직 기록이 없어요</span>
        )}
      </span>
    </button>
  );
}
