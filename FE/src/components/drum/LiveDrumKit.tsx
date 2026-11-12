import { DrumKit, type DrumKitProps } from './DrumKit';
import { useHihatPedal } from './useHihatPedal';
import { usePedalHitSeq } from './usePedalHitSeq';

/**
 * 실시간 하이햇 페달 상태(열림·닫힘·연결 없음·밟는 순간)를 반영하는 DrumKit.
 * 페달 구독을 이 래퍼 안에 가둬, 타격·페달 변화로 연주 화면 루트가 다시 그려지지 않게 한다.
 */
export function LiveDrumKit(props: DrumKitProps) {
  const { closed, pedalOff } = useHihatPedal();
  const pedalHitSeq = usePedalHitSeq();
  return <DrumKit {...props} hihatClosed={closed} pedalOff={pedalOff} pedalHitSeq={pedalHitSeq} />;
}
