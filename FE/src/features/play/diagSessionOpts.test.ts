// 진단 session 줄에 싣는 진동 방식(PLAY-006): 모니터 빌드가 아니면 저장값과 무관하게 판정 진동이다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TIMING } from '@/domain/play/judgement';
import { useSettings } from '@/store/settingsStore';
import { diagSessionOpts } from './diagSessionOpts';

afterEach(() => {
  vi.unstubAllEnvs();
  useSettings.setState({ playHaptic: 'judgement' });
});

describe('diagSessionOpts haptic', () => {
  it('일반 빌드에서는 저장값이 local이어도 judgement', () => {
    vi.stubEnv('VITE_MONITOR', 'false');
    useSettings.setState({ playHaptic: 'local' });
    expect(diagSessionOpts(DEFAULT_TIMING).haptic).toBe('judgement');
  });

  it('모니터 빌드에서는 저장값을 따른다', () => {
    vi.stubEnv('VITE_MONITOR', 'true');
    useSettings.setState({ playHaptic: 'local' });
    expect(diagSessionOpts(DEFAULT_TIMING).haptic).toBe('local');
  });
});
