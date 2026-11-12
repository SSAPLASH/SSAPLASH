import { describe, expect, it } from 'vitest';
import { freeStage } from './freeStage';

describe('freeStage', () => {
  it('키보드 전용(none)은 연결과 무관하게 ready', () => {
    expect(freeStage({ sensorKind: 'none', hasUsageGuide: false, connected: [false, false] })).toBe('ready');
  });

  it('usageGuide 소스는 연결과 무관하게 ready', () => {
    expect(freeStage({ sensorKind: 'pointer', hasUsageGuide: true, connected: [false, false] })).toBe('ready');
  });

  it('센서 양손 미연결은 empty', () => {
    expect(freeStage({ sensorKind: 'websocket', hasUsageGuide: false, connected: [false, false] })).toBe('empty');
  });

  it('한 손만 연결(양쪽 모두)은 oneHand', () => {
    expect(freeStage({ sensorKind: 'websocket', hasUsageGuide: false, connected: [true, false] })).toBe('oneHand');
    expect(freeStage({ sensorKind: 'websocket', hasUsageGuide: false, connected: [false, true] })).toBe('oneHand');
  });

  it('양손 연결은 ready', () => {
    expect(freeStage({ sensorKind: 'websocket', hasUsageGuide: false, connected: [true, true] })).toBe('ready');
  });
});
