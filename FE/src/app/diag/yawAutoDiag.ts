// 패드 위치 자동 보정 켬·끔 진단 줄(yawAuto). 10초마다, 곡 시작 직후 1회, 그리고 값이 바뀔 때 낸다(설계 PLAY-002-yaw-auto-correct-toggle 3절).
// 녹화 파일만 보고 그 판이 자동 보정을 켠 판인지 끈 판인지 알기 위한 줄이다. 녹화를 곡 시작 뒤에 켜도 남도록 주기로도 낸다(audio 줄과 같은 이유).
// 모니터가 보고 있지 않으면 내지 않는다.
import { diagTap } from '@/engine/diagTap';
import { addDiagSessionStartHook } from '@/engine/diagReport';

/** yawAuto 진단 줄 주기(ms) */
export const YAW_AUTO_DIAG_INTERVAL_MS = 10_000;

export interface YawAutoDiag {
  /** 설정이 바뀌었을 수 있을 때 부른다. 마지막으로 본 값과 다르면 줄을 낸다 */
  sync: () => void;
  /** 주기 타이머와 곡 시작 훅을 푼다 */
  stop: () => void;
}

export function startYawAutoDiag(get: () => boolean): YawAutoDiag {
  let last = get();
  const publish = () => {
    last = get();
    if (diagTap.active) diagTap.publish({ type: 'yawAuto', on: last });
  };
  const timer = globalThis.setInterval(publish, YAW_AUTO_DIAG_INTERVAL_MS);
  const off = addDiagSessionStartHook(publish);
  return {
    sync: () => {
      if (get() !== last) publish();
    },
    stop: () => {
      globalThis.clearInterval(timer);
      off();
    },
  };
}
