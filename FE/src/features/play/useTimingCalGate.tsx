// 첫 연주 전 박자 맞추기 권유 관문(설계 PLAY-004-timing-cal-stick-kick 4-3). PlayPage·SheetPage가 연주를 시작하는 한 지점(startPlay)에서 건다.
// 조건(센서 입력 + 측정 기록 없음 + 아직 권하지 않음)이면 연주 대신 대화상자를 열고, 닫으면 연주를 자동으로 시작하지 않고 원래 화면으로 돌려 보낸다.
// 다시 [시작]을 누르면 상태가 done·skipped라 관문이 열린다. 연주 시작을 막는 일은 이 한 번뿐이다.
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { TimingCalDialog } from '@/components/calibration/TimingCalDialog';
import { shouldPromptTimingCal } from '@/domain/kit/calibration/timingCalPrompt';
import { useSettings } from '@/store/settingsStore';

interface Options {
  /** 지금 입력이 센서인가. 시작 시점의 값을 읽도록 함수로 받는다(관문 함수의 정체성을 바꾸지 않으려고) */
  isSensor: () => boolean;
  /** 대화상자가 닫혔을 때(적용·나중에 하기·닫기 모두). 시작 대기 대상 정리 등 화면 쪽 되돌리기 */
  onClosed?: () => void;
}

export function useTimingCalGate({ isSensor, onClosed }: Options): { gate: () => boolean; dialog: ReactNode; open: boolean } {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const applied = useRef(false);
  const isSensorRef = useRef(isSensor);
  const onClosedRef = useRef(onClosed);
  // 렌더 중 ref 쓰기를 피하려고 그리기 전에 맞춘다(다른 연주 화면 ref와 같은 방식)
  useLayoutEffect(() => {
    isSensorRef.current = isSensor;
    onClosedRef.current = onClosed;
  });

  /** true면 연주를 시작하지 않는다(대화상자를 띄웠거나 이미 떠 있다) */
  const gate = useCallback((): boolean => {
    if (openRef.current) return true;
    const s = useSettings.getState();
    if (!shouldPromptTimingCal({ sensor: isSensorRef.current(), timingCal: s.timingCal, prompt: s.timingCalPrompt })) return false;
    applied.current = false;
    openRef.current = true;
    setOpen(true);
    return true;
  }, []);

  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    useSettings.getState().setTimingCalPrompt(applied.current ? 'done' : 'skipped');
    onClosedRef.current?.();
  }, []);

  const dialog = open ? (
    <TimingCalDialog
      intro
      onApplied={() => {
        applied.current = true;
      }}
      onClose={close}
    />
  ) : null;
  return { gate, dialog, open };
}
