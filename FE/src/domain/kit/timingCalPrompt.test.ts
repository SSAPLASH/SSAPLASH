import { describe, expect, it } from 'vitest';
import { shouldPromptTimingCal, shouldRemindTimingCal, type TimingCalPrompt } from './timingCalPrompt';
import type { TimingCalRecord } from './timingCalibration';

const rec: TimingCalRecord = { measuredAt: 1, medianMs: -60, madMs: 8, pairs: 12, input: 'sensor', outputLatencyMs: null, kick: null };
const prompts: TimingCalPrompt[] = ['none', 'skipped', 'done'];

describe('shouldPromptTimingCal (첫 연주 직전)', () => {
  it('센서이고 기록이 없고 none일 때만 true', () => {
    for (const sensor of [true, false]) {
      for (const timingCal of [null, rec]) {
        for (const prompt of prompts) {
          const expected = sensor && timingCal === null && prompt === 'none';
          expect(shouldPromptTimingCal({ sensor, timingCal, prompt })).toBe(expected);
        }
      }
    }
  });
});

describe('shouldRemindTimingCal (결과 화면 띠)', () => {
  it('센서이고 기록이 없고 skipped일 때만 true', () => {
    for (const sensor of [true, false]) {
      for (const timingCal of [null, rec]) {
        for (const prompt of prompts) {
          const expected = sensor && timingCal === null && prompt === 'skipped';
          expect(shouldRemindTimingCal({ sensor, timingCal, prompt })).toBe(expected);
        }
      }
    }
  });
});
