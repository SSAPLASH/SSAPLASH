// 공용 타격음 스위치(QA 352): 기본은 끔, 화면이 켜야 울리고, 보정 중 막음은 화면 설정을 덮어쓰지 않는다
import { beforeEach, describe, expect, it } from 'vitest';
import { hitSoundActive, resetHitSoundForTest, setCalibrationSound, setSoundOnHit } from './hitSound';

beforeEach(() => resetHitSoundForTest());

describe('hitSound', () => {
  it('기본은 꺼져 있다(드럼이 없는 화면에서 울리지 않음)', () => {
    expect(hitSoundActive()).toBe(false);
  });

  it('화면이 켜면 울리고, 떠나며 끄면 멈춘다', () => {
    setSoundOnHit(true);
    expect(hitSoundActive()).toBe(true);
    setSoundOnHit(false);
    expect(hitSoundActive()).toBe(false);
  });

  it('보정 중에는 막고, 끝나면 화면 설정으로 돌아간다', () => {
    setSoundOnHit(true);
    setCalibrationSound(false);
    expect(hitSoundActive()).toBe(false);
    setCalibrationSound(true);
    expect(hitSoundActive()).toBe(true);
  });

  it('소리 없는 화면에서 보정이 끝나도 켜지지 않는다', () => {
    setCalibrationSound(false);
    setSoundOnHit(false);
    setCalibrationSound(true);
    expect(hitSoundActive()).toBe(false);
  });
});
