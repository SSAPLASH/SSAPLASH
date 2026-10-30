import { describe, expect, it } from 'vitest';
import { parseLogText } from './logParse';

describe('parseLogText', () => {
  it('BOOT 1.0 nrf52처럼 해시가 아닌 빌드 식별자도 BOOT로 받는다', () => {
    expect(parseLogText('BOOT 1.0 nrf52')).toEqual({ kind: 'boot', version: '1.0', hash: 'nrf52', raw: 'BOOT 1.0 nrf52' });
  });

  it('BOOT', () => {
    expect(parseLogText('BOOT 0.1 abc123')).toEqual({ kind: 'boot', version: '0.1', hash: 'abc123', raw: 'BOOT 0.1 abc123' });
  });
  it('drop', () => {
    expect(parseLogText('drop weak 320')).toEqual({ kind: 'drop', reason: 'weak', dps: 320, raw: 'drop weak 320' });
    expect(parseLogText('drop  slow   512')).toMatchObject({ kind: 'drop', reason: 'slow', dps: 512 });
  });
  it('drop short', () => {
    expect(parseLogText('drop short 90')).toMatchObject({ kind: 'drop', reason: 'short', dps: 90 });
  });
  it('BIAS x y z(0.1°/s)와 BIAS default', () => {
    expect(parseLogText('BIAS 12 -3 5')).toEqual({ kind: 'bias', values: [12, -3, 5], raw: 'BIAS 12 -3 5' });
    expect(parseLogText('BIAS default')).toEqual({ kind: 'bias', values: null, raw: 'BIAS default' });
    expect(parseLogText('BIAS 1 2')).toMatchObject({ kind: 'text' });
    expect(parseLogText('BIAS a b c')).toMatchObject({ kind: 'text' });
  });
  it('IMU FAIL, 그 밖의 Feather LOG는 text 그대로', () => {
    expect(parseLogText('IMU FAIL')).toEqual({ kind: 'imuFail', raw: 'IMU FAIL' });
    for (const t of ['hold still...', 'RESET_POSE (btn)', 'HAPTIC n/a']) expect(parseLogText(t)).toEqual({ kind: 'text', raw: t });
  });
  it('I2C REC', () => {
    expect(parseLogText('I2C REC 3')).toEqual({ kind: 'i2cRec', count: 3, raw: 'I2C REC 3' });
  });
  it('잘못된 숫자·빈 문자열·모르는 형식은 text', () => {
    expect(parseLogText('drop weak abc')).toEqual({ kind: 'text', raw: 'drop weak abc' });
    expect(parseLogText('I2C REC x')).toMatchObject({ kind: 'text' });
    expect(parseLogText('')).toEqual({ kind: 'text', raw: '' });
    expect(parseLogText('hello')).toMatchObject({ kind: 'text' });
  });
});
