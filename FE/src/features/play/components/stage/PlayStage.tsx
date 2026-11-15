// 연주 화면 골격 (Figma Play 112:499, 설계 3-4). HUD · 구분선 · 영역(하이웨이/악보) · 드럼 영역 슬롯을 배치만 한다.
// 카운트다운·오버레이는 overlay 슬롯으로 같은 골격 위에 얹는다.
import type { CSSProperties, ReactNode } from 'react';
import './PlayStage.css';

interface Props {
  /** game: HUD·구분선이 하이웨이 폭(1060) 가운데 / sheet: 전폭 */
  variant: 'game' | 'sheet';
  hud: ReactNode;
  /** 하이웨이(폭 1060, 높이는 남는 화면 높이) 또는 악보(전폭, 높이는 킷을 뺀 남는 화면 높이 — 1280×860에서 274) */
  area: ReactNode;
  /** 드럼 영역 왼쪽 안내 칸(GuideSlot) */
  guide: ReactNode;
  /** 드럼 킷. 게임은 네온 0.6배(456×180), 화면 높이 820 이상이면 0.7배(532×210). 악보는 kitSize(없으면 532×210) */
  kit: ReactNode;
  /** 악보 연습의 킷 칸 크기(CSS px). 악보 칸을 뺀 남는 높이에 맞춰 화면마다 다르다(kit/sheetKitFit). 리듬 게임은 쓰지 않는다 */
  kitSize?: { width: number; height: number };
  /** 최근 타격 표시(HitReadout) */
  readout: ReactNode;
  /** 레인 → 패드 연결 층(리듬 게임). 하이웨이 위, 킷 아래에 겹친다 */
  link?: ReactNode;
  /** 카운트다운·일시정지 등 위에 얹는 것 */
  overlay?: ReactNode;
}

export function PlayStage({ variant, hud, area, guide, kit, readout, overlay, link, kitSize }: Props) {
  const style = kitSize ? ({ '--kit-w': `${kitSize.width}px`, '--kit-h': `${kitSize.height}px` } as CSSProperties) : undefined;
  return (
    // 연주 중에는 화면 어디를 클릭해도 포인터 모의 스틱 타격이다(자세가 화면 전체 기준이라서. QA 352)
    <div className={`play-stage ${variant}`} style={style} data-pointer-strike="">
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
