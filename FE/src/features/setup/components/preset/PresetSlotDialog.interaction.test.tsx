// @vitest-environment happy-dom
// 프리셋 슬롯 창의 삭제 확인 흐름: 휴지통 → 카드 안 확인 → [삭제]를 눌러야 onDelete, [취소]는 원래 카드로.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PresetSlotDialog } from './PresetSlotDialog';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import type { KitPreset } from '@/domain/kit/preset';

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
const items = [preset('a', '내 배치'), preset('b', '합주실')];

function setup(over: Partial<Parameters<typeof PresetSlotDialog>[0]> = {}) {
  const onApply = vi.fn();
  const onDelete = vi.fn();
  const view = render(
    <PresetSlotDialog open presets={items} activeId="a" draftMode={false} busy={false} onApply={onApply} onPickEmpty={() => {}} onDelete={onDelete} onClose={() => {}} {...over} />,
  );
  return { onApply, onDelete, ...view };
}

afterEach(cleanup);

describe('PresetSlotDialog 삭제 확인', () => {
  it('휴지통을 누르면 그 카드만 확인으로 바뀌고, 적용도 삭제도 일어나지 않는다', () => {
    const { onApply, onDelete } = setup();
    fireEvent.click(screen.getByLabelText('합주실 프리셋 지우기'));
    expect(screen.getByText(/프리셋을 지울까요/).textContent).toContain("'합주실'");
    expect(screen.getByText('되돌릴 수 없어요.')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    // 다른 슬롯의 휴지통은 그대로 있다
    expect(screen.getByLabelText('내 배치 프리셋 지우기')).toBeTruthy();
  });

  it('[삭제]를 누르면 그 id로 onDelete를 부른다', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByLabelText('합주실 프리셋 지우기'));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('b');
  });

  it('[취소]를 누르면 원래 카드로 돌아오고 onDelete는 없다', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByLabelText('합주실 프리셋 지우기'));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByText(/프리셋을 지울까요/)).toBeNull();
    expect(screen.getByLabelText('합주실 프리셋 지우기')).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('적용 중인 프리셋은 시스템 기본으로 바뀐다고 알린다', () => {
    setup();
    fireEvent.click(screen.getByLabelText('내 배치 프리셋 지우기'));
    expect(screen.getByText(/지우면 시스템 기본으로 바뀌어요/)).toBeTruthy();
  });

  it('슬롯을 누르면 적용한다(휴지통과 따로 동작)', () => {
    const { onApply } = setup();
    fireEvent.click(screen.getByText('합주실'));
    expect(onApply).toHaveBeenCalledWith('b');
  });

  it('지워져 목록에서 빠지면 확인 카드도 사라진다', () => {
    const { rerender, onDelete } = setup();
    fireEvent.click(screen.getByLabelText('합주실 프리셋 지우기'));
    rerender(<PresetSlotDialog open presets={[items[0]]} activeId="a" draftMode={false} busy={false} onApply={() => {}} onPickEmpty={() => {}} onDelete={onDelete} onClose={() => {}} />);
    expect(screen.queryByText(/프리셋을 지울까요/)).toBeNull();
    expect(screen.getAllByText('빈 슬롯')).toHaveLength(4);
  });
});
