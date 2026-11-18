// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadDialog, type UploadSection } from './UploadDialog';

afterEach(cleanup);

function Host({ locked = false, withSection = true }: { locked?: boolean; withSection?: boolean }) {
  const [value, setValue] = useState<UploadSection>('SONG');
  return (
    <UploadDialog open locked={locked} onClose={() => {}} section={withSection ? { value, onChange: setValue } : undefined}>
      <p>{value === 'SHEET' ? '악보 섹션' : '음원 섹션'}</p>
    </UploadDialog>
  );
}

describe('UploadDialog 섹션 전환', () => {
  it('제목은 「올리기」, 맨 위 [음원·MIDI | 악보]로 전환한다', async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.getByRole('heading', { name: '올리기' })).toBeTruthy();
    expect(screen.getByText('음원 섹션')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: '악보' }));
    expect(screen.getByText('악보 섹션')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '악보' }).getAttribute('aria-checked')).toBe('true');
  });

  it('올리는 중(locked)에는 전환·닫기가 잠긴다', async () => {
    const user = userEvent.setup();
    render(<Host locked />);
    await user.click(screen.getByRole('radio', { name: '악보' }));
    expect(screen.getByText('음원 섹션')).toBeTruthy();
    expect((screen.getByRole('button', { name: '닫기' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('section이 없으면(악보 기능 꺼짐) 기존 「곡 올리기」 창 그대로다', () => {
    render(<Host withSection={false} />);
    expect(screen.getByRole('heading', { name: '곡 올리기' })).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
