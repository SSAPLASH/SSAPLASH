// @vitest-environment happy-dom
// 드럼 세팅 고급 설정의 「킥 판정 타이밍」 슬라이더: 값이 없으면 스틱 값을 보이고, 움직이면 킥 값만 저장한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useSettings } from '@/store/settingsStore';
import { SetupPage } from './SetupPage';

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
  useSettings.setState({ audioOffsetMs: 0, kickOffsetMs: null, timingCal: null });
});

// useBlocker가 데이터 라우터를 요구한다. 고급 설정은 접혀 있으므로 펼친 뒤 본다
function renderPage() {
  const router = createMemoryRouter([{ path: '/setup', element: <SetupPage /> }], { initialEntries: ['/setup'] });
  const view = render(<RouterProvider router={router} />);
  fireEvent.click(screen.getByRole('button', { name: '펼치기' }));
  return view;
}

describe('SetupPage 고급 설정 킥 판정 타이밍', () => {
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

  it('범위는 −250~+100, 5ms 단위이고 입력 불일치 안내가 함께 보인다', () => {
    useSettings.setState({
      sensorKind: 'none',
      timingCal: { measuredAt: new Date(2026, 10, 11).getTime(), medianMs: -66, madMs: 8, pairs: 12, input: 'sensor', outputLatencyMs: 40, kick: null },
    });
    renderPage();
    const stick = slider('스틱 판정 타이밍');
    expect([stick.min, stick.max, stick.step]).toEqual(['-250', '100', '5']);
    expect(screen.getByText('스틱으로 맞춘 값이에요. 키보드로 칠 때는 다시 맞춰 주세요.')).toBeTruthy();
  });

  it('패드 인식 범위 최소·최대 슬라이더가 있다', () => {
    renderPage();
    expect(slider('패드 인식 범위 최소')).toBeTruthy();
    expect(slider('패드 인식 범위 최대')).toBeTruthy();
  });
});
