// 미니게임 목록 카드 (Figma card). 조작 대상은 카드 전체가 아니라 [시작] 버튼이다. 그림은 부품으로 받는다.
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/action/Button';
import { formatMiniScore, type MiniGameInfo } from '@/features/mini/domain/miniCatalog';
import type { MiniRecord } from '@/features/mini/domain/miniRecord';

interface Props {
  info: MiniGameInfo;
  /** 보일 최고 기록. 없으면 「아직 기록이 없어요」 */
  record: MiniRecord | null;
  /** 첫 갈래가 아닌 기록일 때만 값 뒤에 붙는 갈래 이름 */
  variantName?: string;
  art: ReactNode;
  onStart: () => void;
}

export function MiniCard({ info, record, variantName, art, onStart }: Props) {
  return (
    <article className="mini-card">
      <div className="mini-card-top">
        {art}
        <span className="mini-card-tag">{info.tag}</span>
      </div>
      <div className="mini-card-text">
        <h3 className="mini-card-name">{info.name}</h3>
        <p className="mini-card-rule">{info.rule}</p>
      </div>
      <div className="mini-card-record">
        <div className="mini-card-best">
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
        </div>
        <Button variant="secondary" size="sm" onClick={onStart} aria-label={`${info.name} 시작`}>
          시작
        </Button>
      </div>
    </article>
  );
}
