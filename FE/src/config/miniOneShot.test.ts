import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(value: string | undefined) {
  vi.resetModules();
  vi.stubEnv('VITE_MINI_ONESHOT_AUDIO', value as string);
  return import('./miniOneShot');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('miniOneShot', () => {
  it.each([[undefined], [''], ['   ']])('값이 %j이면 꺼져 있다', async (value) => {
    const mod = await load(value);
    expect(mod.ONE_SHOT_AUDIO_BASE).toBeNull();
    expect(mod.ONE_SHOT_ENABLED).toBe(false);
  });

  it('폴더 주소가 있으면 그 값이 음원 주소이고 켜진다', async () => {
    const mod = await load('/event-audio');
    expect(mod.ONE_SHOT_AUDIO_BASE).toBe('/event-audio');
    expect(mod.ONE_SHOT_ENABLED).toBe(true);
  });

  it('앞뒤 공백은 잘라낸다', async () => {
    const mod = await load('  /event-audio  ');
    expect(mod.ONE_SHOT_AUDIO_BASE).toBe('/event-audio');
    expect(mod.ONE_SHOT_ENABLED).toBe(true);
  });
});
