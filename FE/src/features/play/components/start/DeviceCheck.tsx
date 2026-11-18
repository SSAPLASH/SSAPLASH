// 기기 준비 줄 묶음 (Figma ReadyCheck 222:856). 시작 확인 창의 「기기 준비 필요」 변형이 쓴다: 스틱 연결·보정 두 줄.
// 준비 화면이 있던 때의 카드 머리·버튼 줄·프리셋 줄은 없앴다(머리와 버튼은 창이 갖는다).
// props만 받는다. 준비 조건 계산(useReadiness)·이동은 호출자가 한다.
import { Card } from '@/components/ui/layout/Card';
import { DEVICE_META, deviceGroupName, deviceListText, type DeviceId } from '@/domain/kit/device/devices';
import type { ReadinessMissing } from '@/domain/kit/device/readiness';
import './ready.css';

export interface DeviceCheckProps {
  /** 빠진 준비 조건(domain/kit/readiness). 비면 준비 완료 */
  missing: ReadinessMissing[];
  /** 왼손·오른손 스틱 연결. keyboardOnly면 연결 줄을 키보드 입력으로 보인다 */
  connected: [boolean, boolean];
  keyboardOnly?: boolean;
  /** 페달 연결 여부. undefined면 P 점·문구를 그리지 않는다(동글이 아닌 소스·키보드 전용) */
  pedal?: boolean;
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`play-rp-dot ${ok ? 'ok' : 'need'}`} aria-hidden="true" />;
}

function HandDot({ device, on }: { device: DeviceId; on: boolean }) {
  const hand = device === 'LEFT' ? 'l' : device === 'RIGHT' ? 'r' : 'p';
  return (
    <span className="play-rp-hand">
      <span className={`play-rp-hand-dot ${hand}${on ? ' on' : ''}`} aria-hidden="true" />
      {DEVICE_META[device].mark}
    </span>
  );
}

function stickText(connected: [boolean, boolean], keyboardOnly: boolean, pedal?: boolean): string {
  if (keyboardOnly) return '키보드 입력';
  return deviceListText({ left: connected[0], right: connected[1], pedal });
}

export function DeviceCheck({ missing, connected, keyboardOnly = false, pedal }: DeviceCheckProps) {
  const stickOk = !missing.includes('stick') && !missing.includes('pedal');
  const calOk = !missing.includes('firstSetup');
  return (
    <Card padding="md" className={`play-rp-check${missing.length === 0 ? '' : ' need'}`} aria-label="기기 준비">
      <ul className="play-rp-rows">
        <li className="play-rp-row">
          <Dot ok={stickOk} />
          <span className="play-rp-row-label">{deviceGroupName(pedal !== undefined)} 연결</span>
          <span className="play-rp-row-value">
            {!keyboardOnly && (
              <span className="play-rp-hands">
                <HandDot device="LEFT" on={connected[0]} />
                <HandDot device="RIGHT" on={connected[1]} />
                {pedal !== undefined && <HandDot device="PEDAL" on={pedal} />}
              </span>
            )}
            <span className={stickOk ? '' : 'need'}>{stickText(connected, keyboardOnly, pedal)}</span>
          </span>
        </li>
        <li className="play-rp-row">
          <Dot ok={calOk} />
          <span className="play-rp-row-label">보정</span>
          <span className="play-rp-row-value">
            <span className={calOk ? '' : 'need'}>{calOk ? '완료' : '필요'}</span>
          </span>
        </li>
      </ul>
    </Card>
  );
}
