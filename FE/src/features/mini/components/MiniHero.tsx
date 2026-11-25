// 미니게임 목록의 큰 카드 (설계 MODE-006-minigame-list-ui D3·D7). 고른 게임 하나를 게임 색 면 위에 크게 보인다.
// 왼쪽은 꼬리표·이름·한 줄 규칙·큰 그림, 오른쪽 칸은 「게임 방법」·기록 줄·[시작]이다. 시작은 이 버튼 하나다(D6).
// 주소·스토어에 접근하지 않는다 — 값은 모두 props로 받고 그림은 부품으로 받는다.
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/action/Button';
import { formatMiniScore, type MiniGameInfo } from '@/features/mini/domain/miniCatalog';
import type { HeroRecordRow } from '@/features/mini/domain/miniRecord';

interface Props {
  info: MiniGameInfo;
  /** 보일 기록 줄(`heroRecords`). 갈래가 있는 게임은 갈래마다 한 줄 */
  rows: readonly HeroRecordRow[];
  art: ReactNode;
  onStart: () => void;
}

export function MiniHero({ info, rows, art, onStart }: Props) {
  const nameId = useId();
  return (
    <section className="mini-hero" data-game={info.id} aria-labelledby={nameId}>
      <div className="mini-hero-main">
        <span className="mini-hero-tag">{info.tag}</span>
        <div className="mini-hero-text">
          <h3 id={nameId} className="mini-hero-name">
            {info.name}
          </h3>
          <p className="mini-hero-rule">{info.rule}</p>
        </div>
        <div className="mini-hero-art">{art}</div>
      </div>
      <div className="mini-hero-side">
        <div className="mini-hero-how">
          <h4 className="mini-hero-label">게임 방법</h4>
          <p className="mini-hero-desc">{info.description}</p>
        </div>
        <dl className="mini-hero-rows">
          {rows.map((row) => (
            <div key={row.label} className="mini-hero-row">
              <dt className="mini-hero-row-label">{row.label}</dt>
              <dd className="mini-hero-row-value">
                {row.record ? (
                  <span className="mini-hero-value">
                    {formatMiniScore(info, row.record.score)}
                    <span className="mini-hero-unit">{info.unit}</span>
                  </span>
                ) : (
                  <span className="mini-hero-empty">아직 기록이 없어요</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <Button className="mini-hero-start" onClick={onStart} aria-label={`${info.name} 시작`}>
          시작
        </Button>
      </div>
    </section>
  );
}
