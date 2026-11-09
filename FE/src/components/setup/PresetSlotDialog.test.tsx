// 프리셋 슬롯 창 SSR 검증(Figma 772:33828, UX-64): 0 시스템 + 저장 슬롯 + 빈 슬롯, 적용 중 표시, 초안 모드 활성 규칙.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PresetSlotDialog } from './PresetSlotDialog';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kitLayout';
import { PRESET_SLOTS, SYSTEM_PRESET_ID, type KitPreset } from '@/domain/preset';

const preset = (id: string, name: string): KitPreset => ({
  id,
  name,
  isDefault: false,
  layout: DEFAULT_KIT_LAYOUT,
  soundSetId: 'ssaplash',
  schemaVersion: 1,
  createdAt: '2026-10-23T10:00:00Z',
  updatedAt: '2026-10-23T10:00:00Z',
});
const noop = () => {};
const render = (over: Partial<Parameters<typeof PresetSlotDialog>[0]> = {}) =>
  renderToStaticMarkup(
    <PresetSlotDialog open presets={[preset('a', '내 배치')]} activeId="a" draftMode={false} busy={false} onApply={noop} onPickEmpty={noop} onClose={noop} {...over} />,
  );

describe('PresetSlotDialog', () => {
  it('0 시스템 + 저장 슬롯 1 + 빈 슬롯 4, 적용 중 슬롯에 「적용 중」·active, 저장 시각', () => {
    const html = render();
    expect(html).toContain('0 · 시스템');
    expect(html).toContain('기본 배치');
    expect(html).toContain('>내 배치<');
    expect(html).toContain('10.23 저장');
    expect((html.match(/>빈 슬롯</g) ?? []).length).toBe(PRESET_SLOTS - 1);
    expect(html).toMatch(/class="setup-slot is-saved active"[^>]*disabled=""/);
    expect((html.match(/적용 중/g) ?? []).length).toBe(1);
    expect(html).toContain('+ 현재 배치 저장');
    expect(html).toContain('>닫기</button>');
  });

  it('시스템 기본이 적용 중이면 0번이 active', () => {
    const html = render({ activeId: SYSTEM_PRESET_ID });
    expect(html).toMatch(/class="setup-slot is-system active"/);
  });

  it('초안 모드: 채워진 슬롯·시스템은 비활성, 빈 슬롯만 활성이고 문구가 「+ 여기에 저장」', () => {
    const html = render({ draftMode: true });
    expect(html).toMatch(/class="setup-slot is-system"[^>]*disabled=""/);
    expect(html).toMatch(/class="setup-slot is-saved active"[^>]*disabled=""/);
    expect(html).not.toMatch(/class="setup-slot is-empty"[^>]*disabled=""/);
    expect(html).toContain('+ 여기에 저장');
    expect(html).toContain('방금 보정한 배치를 저장해요');
  });

  it('닫혀 있으면 아무것도 그리지 않는다', () => {
    expect(render({ open: false })).toBe('');
  });
});
