import { describe, expect, it } from 'vitest';
import { BaseInputSource } from '@/input/source/InputSource';
import { SensorRegistry } from './sensorRegistry';

class FakeSource extends BaseInputSource {
  readonly kind = 'fake';
  readonly label = '가짜 소스';
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

describe('SensorRegistry 예약어', () => {
  it.each(['none', 'keyboard', 'preview', 'touch'])("'%s' 등록은 거부한다", (id) => {
    const r = new SensorRegistry();
    expect(() =>
      r.register({
        id,
        label: id,
        description: '테스트용',
        availability: () => ({ ok: true }),
        create: () => new FakeSource(),
      }),
    ).toThrow('예약된');
  });
});
