// @vitest-environment happy-dom
// 손별 최소 타격 세기(stickMinPeak)와 derived 앵커 저장 검증(PLAY-004 ①③). 설정 버전은 올리지 않고 merge가 정리한다.
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, sanitizeAnchors, useSettings } from './settingsStore';

/** 저장분을 localStorage에 넣고 rehydrate해 merge가 정리한 상태를 읽는다 */
async function mergeStored(persisted: Record<string, unknown>) {
  localStorage.setItem('ssaplash.settings', JSON.stringify({ state: persisted, version: SETTINGS_VERSION }));
  await useSettings.persist.rehydrate();
  return useSettings.getState();
}

describe('stickMinPeak', () => {
  afterEach(() => {
    localStorage.clear();
    useSettings.setState({ stickMinPeak: [null, null], stickAnchors: [null, null], presetAnchors: {}, activePresetId: 'system', calibratedAt: null });
  });

  it('기본값은 [null, null]이고 설정 버전은 그대로 27', () => {
    expect(useSettings.getInitialState().stickMinPeak).toEqual([null, null]);
    expect(SETTINGS_VERSION).toBe(27);
  });

  it('setStickMinPeak는 그 손만 바꾸고 null로 지운다. 범위 밖 값은 null', () => {
    const { setStickMinPeak } = useSettings.getState();
    setStickMinPeak(1, 320);
    expect(useSettings.getState().stickMinPeak).toEqual([null, 320]);
    setStickMinPeak(0, 260.4);
    expect(useSettings.getState().stickMinPeak).toEqual([260, 320]);
    setStickMinPeak(0, 100);
    expect(useSettings.getState().stickMinPeak).toEqual([null, 320]);
    setStickMinPeak(1, null);
    expect(useSettings.getState().stickMinPeak).toEqual([null, null]);
  });

  it('저장분에 없거나 이상하면 [null, null], 값별로 정리한다', async () => {
    expect((await mergeStored({})).stickMinPeak).toEqual([null, null]);
    expect((await mergeStored({ stickMinPeak: 'x' })).stickMinPeak).toEqual([null, null]);
    expect((await mergeStored({ stickMinPeak: [320, 9999] })).stickMinPeak).toEqual([320, null]);
    expect((await mergeStored({ stickMinPeak: [NaN, 250.2] })).stickMinPeak).toEqual([null, 250]);
  });

  it('clearStickAnchors는 최소 타격 세기도 지운다', () => {
    useSettings.getState().setStickMinPeak(0, 300);
    useSettings.getState().clearStickAnchors();
    expect(useSettings.getState().stickMinPeak).toEqual([null, null]);
  });

  it('프리셋 앵커 전환은 최소 타격 세기를 건드리지 않는다', () => {
    useSettings.getState().setStickMinPeak(0, 300);
    useSettings.getState().setPresetAnchors('p', { anchors: [{ SNARE: { pad: 'SNARE', pitch: 0, yaw: 0, radius: 18, samples: 2, spread: 1 } }, null], calibratedAt: 1 });
    expect(useSettings.getState().stickMinPeak).toEqual([300, null]);
  });
});

describe('derived 앵커 보존', () => {
  const raw = [
    { RIDE: { pad: 'RIDE', pitch: 12, yaw: 20, radius: 18, samples: 0, spread: 0, derived: true }, SNARE: { pad: 'SNARE', pitch: 0, yaw: 0, radius: 18, samples: 2, spread: 1 } },
    null,
  ];

  it('sanitizeAnchors는 derived: true만 보존한다', () => {
    const out = sanitizeAnchors(raw);
    expect(out[0]?.RIDE?.derived).toBe(true);
    expect(out[0]?.SNARE?.derived).toBeUndefined();
    const bad = sanitizeAnchors([{ RIDE: { ...raw[0]!.RIDE, derived: 'yes' } }, null]);
    expect(bad[0]?.RIDE?.derived).toBeUndefined();
  });

  it('merge(저장분 읽기)에서 stickAnchors·presetAnchors 모두 derived를 지키고 setStickAnchors 사본도 같다', async () => {
    const m = await mergeStored({ stickAnchors: raw, presetAnchors: { p: { anchors: raw, calibratedAt: 5 } } });
    expect(m.stickAnchors[0]?.RIDE?.derived).toBe(true);
    expect(m.presetAnchors.p?.anchors[0]?.RIDE?.derived).toBe(true);
    useSettings.setState({ activePresetId: 'p' });
    useSettings.getState().setStickAnchors(m.stickAnchors, 7);
    expect(useSettings.getState().presetAnchors.p?.anchors[0]?.RIDE?.derived).toBe(true);
  });
});
