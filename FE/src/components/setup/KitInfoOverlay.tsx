// 드럼 배치 캔버스 오른쪽 아래(또는 왼쪽 아래)에 겹쳐 띄우는 정보 카드(PLAY-004 D10). 공통 틀 + 본문 슬롯 구조다.
// 세로형(폭 190): 맨 위 패드 이름+보조 캡션 / X·Y·반지름이 한 줄에 하나씩(라벨 왼쪽·큰 숫자 오른쪽) / 반지름 슬라이더(앵커가 있을 때만).
// 편집(평소)에는 버튼이 없다.
// 보정 진행·경고·결과 상태는 같은 틀에 children이나 tone으로 얹는다. 표시용 값과 콜백만 받고 계산은 하지 않는다(설계 2절).
import type { ReactNode, Ref } from 'react';
import { RadiusSlider, type RadiusSliderProps } from '@/components/calibration/RadiusSlider';

export type KitInfoCorner = 'right' | 'left';

export interface KitInfoFrameProps {
  /** 캔버스 안에서 붙일 아래쪽 모서리. 지금 칠 패드를 가리면 left(domain/kitLayout.overlayCorner) */
  corner?: KitInfoCorner;
  /** warn이면 --warn 테두리(간격 경고·겹침 표시) */
  tone?: 'warn';
  /** 카드 실제 크기를 재는 훅(useOverlayRegion)에 연결하는 ref */
  cardRef?: Ref<HTMLElement>;
  children: ReactNode;
}

/** 공통 틀: 위치·바탕·테두리만 맡는다. 본문은 상태별로 채운다 */
export function KitInfoFrame({ corner = 'right', tone, cardRef, children }: KitInfoFrameProps) {
  return (
    <aside ref={cardRef} className={`setup-kitinfo ${corner}${tone ? ` ${tone}` : ''}`} aria-label="선택 패드 정보">
      {children}
    </aside>
  );
}

/** 카드 맨 위: 패드 이름 + 보조 캡션(편집 「선택 패드」, 진행 「n / 7」) */
export function KitInfoHead({ name, caption, nameClassName }: { name: string; caption?: string; nameClassName?: string }) {
  return (
    <div className="setup-kitinfo-head">
      <h3 className={`setup-kitinfo-name${nameClassName ? ` ${nameClassName}` : ''}`}>{name}</h3>
      {caption && <p className="setup-kitinfo-caption">{caption}</p>}
    </div>
  );
}

export interface KitInfoOverlayProps {
  corner?: KitInfoCorner;
  tone?: 'warn';
  cardRef?: Ref<HTMLElement>;
  /** 패드 이름 */
  name: string;
  /** 이름 아래 보조 캡션. 없으면 「선택 패드」 */
  caption?: string;
  /** 표시용 값(문자열). 단위 변환은 호출자가 한다 */
  x: string;
  y: string;
  radius: string;
  /** 판정 반경 슬라이더. 보정된 패드(앵커 있음)만 넘기고, 없으면 슬라이더를 그리지 않는다 */
  slider?: Pick<RadiusSliderProps, 'value' | 'min' | 'max' | 'disabled' | 'onChange'> | null;
  /** 이름·값·슬라이더 아래에 붙는 상태별 내용 */
  children?: ReactNode;
}

export function KitInfoOverlay({ corner, tone, cardRef, name, caption = '선택 패드', x, y, radius, slider = null, children }: KitInfoOverlayProps) {
  return (
    <KitInfoFrame corner={corner} tone={tone} cardRef={cardRef}>
      <KitInfoHead name={name} caption={caption} />
      <dl className="setup-kitinfo-values">
        <KitInfoValue label="X" value={x} />
        <KitInfoValue label="Y" value={y} />
        <KitInfoValue label="반지름" value={radius} />
      </dl>
      {slider && <RadiusSlider {...slider} />}
      {children}
    </KitInfoFrame>
  );
}

function KitInfoValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
