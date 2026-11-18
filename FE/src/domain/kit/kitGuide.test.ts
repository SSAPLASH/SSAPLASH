import { describe, expect, it } from 'vitest';
import { kitBoxFor, kitPadsFor } from '@/domain/kit/drumKit';
import { kitGuideLabels } from './kitGuide';

describe('kitGuideLabels (자유 연습 키트 가이드 이름표)', () => {
  it('실물: 원근 배치 순서대로 9개, 이름은 패드 라벨', () => {
    const labels = kitGuideLabels('acoustic', false);
    expect(labels.map((l) => l.pad)).toEqual(kitPadsFor('acoustic', 'persp').map((p) => p.pad));
    expect(labels).toHaveLength(9);
    expect(labels.find((l) => l.pad === 'HIHAT_PEDAL')?.name).toBe('하이햇 페달');
  });

  it('자리 % = (조각 왼쪽·위 + label × 조각 폭/160) ÷ 킷 상자', () => {
    const box = kitBoxFor('acoustic', 'persp');
    const crash = kitPadsFor('acoustic', 'persp').find((p) => p.pad === 'CRASH')!;
    const k = crash.w / 160;
    const label = kitGuideLabels('acoustic', false).find((l) => l.pad === 'CRASH')!;
    expect(label.xPct).toBeCloseTo(((crash.left + crash.art!.label.x * k) / box.w) * 100, 6);
    expect(label.yPct).toBeCloseTo(((crash.top + crash.art!.label.y * k) / box.h) * 100, 6);
    // 목업 값(크래시: 22.8 + 79.8 × 123.1/160 → 약 11.08%)
    expect(label.xPct).toBeCloseTo(11.08, 1);
  });

  it('모든 이름표가 킷 상자 가로 안쪽에 있다', () => {
    for (const l of kitGuideLabels('acoustic', false)) {
      expect(l.xPct).toBeGreaterThan(0);
      expect(l.xPct).toBeLessThan(100);
      expect(l.yPct).toBeGreaterThan(0);
    }
  });

  it('showKeys면 KEY_MAP의 키를 Key·Digit을 뗀 글자로 붙인다', () => {
    const labels = kitGuideLabels('acoustic', true);
    const keysOf = (pad: string) => labels.find((l) => l.pad === pad)?.keys;
    expect(keysOf('SNARE')).toEqual(['F', 'J']);
    expect(keysOf('CRASH')).toEqual(['R', 'U']);
    expect(keysOf('KICK')).toEqual(['Space']);
    expect(keysOf('HIHAT_PEDAL')).toEqual(['B']);
  });

  it('showKeys가 아니면 키는 빈 배열', () => {
    expect(kitGuideLabels('acoustic', false).every((l) => l.keys.length === 0)).toBe(true);
  });

  it('전자·네온은 빈 배열(내장 글자를 쓴다)', () => {
    expect(kitGuideLabels('electronic', true)).toEqual([]);
    expect(kitGuideLabels('neon', false)).toEqual([]);
  });
});
