import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT_LAYOUT, KIT_LAYOUT_PRESETS } from './kitLayout';
import { PRESET_NAME_MAX, isDirty, layoutEquals, normalizePresetName, validatePresetName, type KitPreset } from './preset';

function preset(over: Partial<KitPreset> = {}): KitPreset {
  return {
    id: 'a',
    name: '기본',
    isDefault: true,
    layout: DEFAULT_KIT_LAYOUT,
    soundSetId: 'ssaplash',
    schemaVersion: 1,
    createdAt: 't',
    updatedAt: 't',
    ...over,
  };
}

describe('validatePresetName', () => {
  it('공백뿐이면 EMPTY', () => {
    expect(validatePresetName('   ', [])).toBe('EMPTY');
  });
  it('trim 뒤 50자 초과면 TOO_LONG, 50자는 통과', () => {
    expect(validatePresetName('a'.repeat(PRESET_NAME_MAX + 1), [])).toBe('TOO_LONG');
    expect(validatePresetName(` ${'a'.repeat(PRESET_NAME_MAX)} `, [])).toBeNull();
  });
  it('같은 이름은 DUPLICATE(대소문자 구분), exceptId 자신은 제외', () => {
    const list = [preset({ id: 'a', name: 'Rock' })];
    expect(validatePresetName(' Rock ', list)).toBe('DUPLICATE');
    expect(validatePresetName('rock', list)).toBeNull();
    expect(validatePresetName('Rock', list, 'a')).toBeNull();
  });
  it('정상 이름은 null', () => {
    expect(validatePresetName('내 킷', [preset()])).toBeNull();
    expect(normalizePresetName('  내 킷 ')).toBe('내 킷');
  });
});

describe('isDirty', () => {
  const cur = { layout: DEFAULT_KIT_LAYOUT, soundSetId: 'ssaplash' as const };
  it('같으면 false', () => expect(isDirty(cur, preset())).toBe(false));
  it('배치가 다르면 true', () => expect(isDirty({ ...cur, layout: KIT_LAYOUT_PRESETS.wide }, preset())).toBe(true));
  it('사운드가 다르면 true', () => expect(isDirty({ ...cur, soundSetId: 'synth' }, preset())).toBe(true));
  it('적용 프리셋이 없으면 true', () => expect(isDirty(cur, undefined)).toBe(true));
});

describe('layoutEquals', () => {
  it('1e-6 이내 차이는 같다', () => {
    const b = { ...DEFAULT_KIT_LAYOUT, SNARE: { ...DEFAULT_KIT_LAYOUT.SNARE, x: DEFAULT_KIT_LAYOUT.SNARE.x + 1e-7 } };
    expect(layoutEquals(DEFAULT_KIT_LAYOUT, b)).toBe(true);
  });
  it('x·y·r 중 하나라도 어긋나면 다르다', () => {
    for (const key of ['x', 'y', 'r'] as const) {
      const b = { ...DEFAULT_KIT_LAYOUT, RIDE: { ...DEFAULT_KIT_LAYOUT.RIDE, [key]: DEFAULT_KIT_LAYOUT.RIDE[key] + 0.01 } };
      expect(layoutEquals(DEFAULT_KIT_LAYOUT, b)).toBe(false);
    }
  });
});
