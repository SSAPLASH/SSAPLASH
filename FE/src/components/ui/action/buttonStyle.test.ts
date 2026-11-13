import { describe, expect, it } from 'vitest';
import { buttonClassName } from './buttonStyle';

describe('buttonClassName', () => {
  it('기본값은 primary·md', () => {
    expect(buttonClassName()).toBe('ui-btn ui-btn-primary ui-btn-md');
  });

  it('변이·크기·fullWidth·추가 클래스를 조합한다', () => {
    expect(buttonClassName({ variant: 'danger', size: 'sm', fullWidth: true, className: 'x' })).toBe(
      'ui-btn ui-btn-danger ui-btn-sm ui-btn-full x',
    );
  });

  it('fullWidth가 아니면 ui-btn-full이 없다', () => {
    expect(buttonClassName({ variant: 'text' })).not.toContain('ui-btn-full');
  });
});
