// 패드 보정 팝업(SETUP-fixed-kit-noir D5, 안 B). 드럼 세팅의 [새로 보정]·[다시 보정]을 누르면 calibration.mode가 capture가 되고, 그동안 이 팝업이 열린다.
// 열림은 호출자(SetupPage)가 마운트 여부로 정한다. 바깥을 눌러도 닫지 않는다(실수로 진행을 날리지 않게, U6): Esc와 [그만하기]만 calibrationSession.cancelCapture()를 부른다.
// 껍데기만 맡는다: 위쪽 작은 라벨(무엇을 보정 중인지) + [그만하기], 본문은 CalibrationStage(큰 안내·진행 점·드럼 그림과 그 위 첫 안내·손별 타격 점·결과 화면). 계산은 하지 않는다.
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { calibrationSession } from '@/runtime/calibrationSession';
import { useLive } from '@/store/liveStore';
import { CalibrationStage } from './CalibrationStage';

export interface CalibrationDialogProps {
  /** 적용 프리셋 이름(「{이름} 다시 보정 · 드럼 위치」 라벨용) */
  presetName: string;
  /** 결과 화면의 [저장]: 세션을 끝내고(active) 또는 초안을 받아(new) 저장 흐름을 연다 */
  onSave: () => void;
}

export function CalibrationDialog({ presetName, onSave }: CalibrationDialogProps) {
  const target = useLive((l) => l.calibration.target);
  const label = target === 'new' ? '새 프리셋 보정 · 드럼 위치' : `${presetName} 다시 보정 · 드럼 위치`;
  const stop = () => calibrationSession.cancelCapture();
  return (
    <Dialog className="cal-dialog" labelledBy="cal-dialog-title" closeOnBackdrop={false} onClose={stop}>
      <div className="cal-dialog-head">
        <h2 id="cal-dialog-title" className="cal-dialog-label">
          {label}
        </h2>
        <Button variant="secondary" size="sm" onClick={stop}>
          그만하기
        </Button>
      </div>
      <CalibrationStage onSave={onSave} notice />
    </Dialog>
  );
}
