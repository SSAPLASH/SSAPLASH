// 제어 섹션: 데이터가 아니라 도구(파라미터 표·명령 바). 기존 파라미터·명령 탭을 그대로 옮겼다.
import type { CalibrationProfile } from '@/domain/calibration';
import type { ParamStore } from '@/monitor/params';
import { CommandBar } from '../CommandBar';
import type { SendFn } from '../monitorTypes';
import { ParamPanel } from '../ParamPanel';

export function ControlSection({
  store,
  send,
  profile,
  canSend,
}: {
  store: ParamStore;
  send: SendFn;
  profile: CalibrationProfile;
  canSend: boolean;
}) {
  return (
    <div className="mon-section">
      <h2 className="mon-section-title">제어</h2>
      <div className="mon-param-grid">
        <ParamPanel store={store} canSend={canSend} />
        <CommandBar send={send} store={store} profile={profile} canSend={canSend} />
      </div>
    </div>
  );
}
