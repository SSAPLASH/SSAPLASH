// 자유 연습 키트 가이드 스위치(MODE-002 D2): 무대 오른쪽 위 켬·끔. 설정 저장은 페이지가 맡고, 여기서는 받은 값만 그린다.
// 패드 이름표 알약은 공유 부품 components/drum/KitGuideLabels가 그린다

interface SwitchProps {
  on: boolean;
  onChange: (on: boolean) => void;
}

/** 「키트 가이드」 켬·끔 스위치 */
export function KitGuideSwitch({ on, onChange }: SwitchProps) {
  return (
    <button type="button" className="free-guide-sw" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      키트 가이드
      <i aria-hidden="true" />
    </button>
  );
}
