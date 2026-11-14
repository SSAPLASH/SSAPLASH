// 연주 화면 골격 (Figma Play 112:499, 설계 3-4). HUD · 구분선 · 영역(하이웨이/악보) · 드럼 영역 슬롯을 배치만 한다.
// 카운트다운·오버레이는 overlay 슬롯으로 같은 골격 위에 얹는다.
import type { ReactNode } from 'react';
import './PlayStage.css';

interface Props {
  /** game: HUD·구분선이 하이웨이 폭(1060) 가운데 / sheet: 전폭 */
  variant: 'game' | 'sheet';
  hud: ReactNode;
  /** 하이웨이(폭 1060, 높이는 남는 화면 높이) 또는 악보(전폭 ×420) */
  area: ReactNode;
  /** 드럼 영역 왼쪽 안내 칸(GuideSlot) */
  guide: ReactNode;
  /** 드럼 킷. 게임은 네온 0.6배(456×180), 화면 높이 820 이상이면 0.7배(532×210). 악보 0.7배(532×210), 실물 스킨은 위에서 본 그림 245×210(kitTop) */
  kit: ReactNode;
  /** 킷 슬롯을 위에서 본 그림(실물 스킨) 크기로 쓴다. 악보 연습만 쓴다(리듬 게임 킷은 항상 네온) */
  kitTop?: boolean;
  /** 최근 타격 표시(HitReadout) */
  readout: ReactNode;
  /** 레인 → 패드 연결 층(리듬 게임). 하이웨이 위, 킷 아래에 겹친다 */
  link?: ReactNode;
  /** 카운트다운·일시정지 등 위에 얹는 것 */
  overlay?: ReactNode;
}

export function PlayStage({ variant, hud, area, guide, kit, readout, overlay, link, kitTop = false }: Props) {
  return (
    // 연주 중에는 화면 어디를 클릭해도 포인터 모의 스틱 타격이다(자세가 화면 전체 기준이라서. QA 352)
    <div className={kitTop ? `play-stage ${variant} kit-top` : `play-stage ${variant}`} data-pointer-strike="">
      <div className="play-stage-hud">{hud}</div>
      <hr className="play-stage-divider" />
      <div className="play-stage-area">{area}</div>
      {link}
      <div className="play-stage-drum">
        <div className="play-stage-guide">{guide}</div>
        <div className="play-stage-kit">{kit}</div>
        <div className="play-stage-readout">{readout}</div>
      </div>
      {overlay}
    </div>
  );
}
