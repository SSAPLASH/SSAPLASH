// @vitest-environment happy-dom
// 설정의 「킥 판정 타이밍」 슬라이더: 값이 없으면 스틱 값을 보이고, 움직이면 킥 값만 저장한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSettings } from '@/store/settingsStore';
import { SettingsPage } from './SettingsPage';

// Node 실험적 localStorage가 happy-dom 것을 가려 persist 저장이 실패한다 — import 전에 메모리 저장소로 대체한다
vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
});

const slider = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

beforeEach(() => {
  useSettings.setState({ audioOffsetMs: -65, kickOffsetMs: null });
});
afterEach(() => {
  cleanup();
  useSettings.setState({ audioOffsetMs: 0, kickOffsetMs: null });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe('SettingsPage 킥 판정 타이밍', () => {
  it('킥 값이 null이면 스틱 값을 보여 준다', () => {
    renderPage();
    expect(slider('스틱 판정 타이밍').value).toBe('-65');
    expect(slider('킥 판정 타이밍').value).toBe('-65');
  });

  it('킥 슬라이더를 움직이면 킥 값만 저장한다', () => {
    renderPage();
    fireEvent.change(slider('킥 판정 타이밍'), { target: { value: '-40' } });
    expect(useSettings.getState().kickOffsetMs).toBe(-40);
    expect(useSettings.getState().audioOffsetMs).toBe(-65);
    expect(slider('킥 판정 타이밍').value).toBe('-40');
  });

  it('스틱 슬라이더를 움직여도 따로 정한 킥 값은 그대로다', () => {
    useSettings.setState({ kickOffsetMs: -40 });
    renderPage();
    fireEvent.change(slider('스틱 판정 타이밍'), { target: { value: '-20' } });
    expect(useSettings.getState().audioOffsetMs).toBe(-20);
    expect(useSettings.getState().kickOffsetMs).toBe(-40);
  });
});
