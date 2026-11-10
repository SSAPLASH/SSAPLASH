// 드럼 배치 캔버스 판(PLAY-004 D11, v0.2). 편집(KitCanvas)과 보정(DrumKit)이 같은 구조를 쓴다.
// 행(.setup-stage-row, 카드 안쪽 전체 폭) 안에 판 하나(.setup-stage-panel: --bg-canvas, 안쪽 여백 24px, position: relative)를 두고,
// 드럼 그림은 판 안쪽 가운데에 16:10 contain으로 놓는다. 떠 있는 요소의 자리: 위쪽 가운데 top / 오른쪽 아래 card / 아래쪽 가운데 banner.
// 자리·겹침 계산은 useOverlayRegion이 하고 이 컴포넌트는 배치만 맡는다.
import type { ReactNode } from 'react';
import type { UseOverlayRegion } from './useOverlayRegion';

export interface StagePanelProps {
  layout: Pick<UseOverlayRegion, 'rowRef' | 'figRef' | 'bannerRef' | 'bannerBottom'>;
  /** 그림 틀에 붙일 추가 클래스(편집기는 setup-editor) */
  figClassName?: string;
  /** 마우스 타격 모의를 막는 표식(편집기: 마우스는 고르기만 한다) */
  noPointerStrike?: boolean;
  /** 위쪽 가운데: 보정 안내·진행 점 */
  top?: ReactNode;
  /** 오른쪽(또는 왼쪽) 아래 정보 카드(KitInfoFrame) */
  card?: ReactNode;
  /** 아래쪽 가운데 경고 배너(GapBanner) */
  banner?: ReactNode;
  /** 드럼 그림(KitCanvas·DrumKit) */
  children: ReactNode;
}

export function StagePanel({ layout: { rowRef, figRef, bannerRef, bannerBottom }, figClassName, noPointerStrike, top, card, banner, children }: StagePanelProps) {
  return (
    <div className="setup-stage-row" ref={rowRef}>
      <div className="setup-stage-panel">
        <div className="setup-stage-inner">
          <div className={`setup-stage-fig${figClassName ? ` ${figClassName}` : ''}`} ref={figRef} data-no-pointer-strike={noPointerStrike ? '' : undefined}>
            {children}
          </div>
        </div>
        {top}
        {banner && (
          <div className="setup-panel-banner" ref={bannerRef} style={{ bottom: bannerBottom }}>
            {banner}
          </div>
        )}
        {card}
      </div>
    </div>
  );
}
