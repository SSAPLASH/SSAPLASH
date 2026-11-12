// 패드 위치 자동 보정 설정 검증: 기본 끔, 켜고 끄기.
import { afterEach, describe, expect, it } from 'vitest';
import { useSettings } from './settingsStore';

describe('yawAutoCorrect', () => {
  afterEach(() => {
    useSettings.getState().setYawAutoCorrect(false);
  });

  it('기본값은 끔', () => {
    expect(useSettings.getInitialState().yawAutoCorrect).toBe(false);
  });

  it('setYawAutoCorrect로 켜고 끈다', () => {
    useSettings.getState().setYawAutoCorrect(true);
    expect(useSettings.getState().yawAutoCorrect).toBe(true);
    useSettings.getState().setYawAutoCorrect(false);
    expect(useSettings.getState().yawAutoCorrect).toBe(false);
  });
});
