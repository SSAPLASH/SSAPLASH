// @vitest-environment happy-dom
// MiniIntro 검증: 시작·스틱 안내·시작을 막는 사유(P2·P13)·조작과 안내 한 줄(P10·P12)·목록 링크.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MiniIntro } from '@/features/mini/components/MiniIntro';

afterEach(cleanup);

type Props = Partial<Parameters<typeof MiniIntro>[0]>;

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

function open(props: Props = {}) {
  const onStart = props.onStart ?? vi.fn();
  const view = render(
    <MemoryRouter initialEntries={['/play/mini/speed']}>
      <Routes>
        <Route
          path="/play/mini/speed"
          element={
            <MiniIntro
              overline="누구보다 빠르게"
              title={['10초 동안 스네어를', '가장 많이 치세요.']}
              description="설명"
              art={<span data-testid="art" />}
              cells={[{ label: '제한 시간', value: '10', unit: '초' }]}
              stickConnected
              {...props}
              onStart={onStart}
            />
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, onStart };
}

const startButton = () => screen.getByRole('button', { name: '시작하기' }) as HTMLButtonElement;

describe('MiniIntro 기본', () => {
  it('[시작하기]를 누르면 onStart가 불린다', () => {
    const { onStart } = open();
    fireEvent.click(startButton());
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('제목 두 줄·그림·칸이 넘긴 대로 보인다', () => {
    open();
    expect(screen.getByText('10초 동안 스네어를')).toBeTruthy();
    expect(screen.getByText('가장 많이 치세요.')).toBeTruthy();
    expect(screen.getByTestId('art')).toBeTruthy();
    expect(screen.getByText('제한 시간')).toBeTruthy();
  });

  it('스틱이 연결돼 있으면 연결 안내 줄과 [드럼 세팅]이 없다', () => {
    open({ stickConnected: true });
    expect(screen.queryByText('스틱이 연결돼 있지 않아요')).toBeNull();
    expect(screen.queryByRole('button', { name: '드럼 세팅' })).toBeNull();
  });

  it('스틱이 연결돼 있지 않으면 안내와 [드럼 세팅]이 보이되 [시작하기]는 눌린다', () => {
    const { onStart } = open({ stickConnected: false });
    expect(screen.getByText('스틱이 연결돼 있지 않아요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '드럼 세팅' })).toBeTruthy();
    expect(startButton().disabled).toBe(false);
    fireEvent.click(startButton());
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('[드럼 세팅]을 누르면 /setup으로 간다', () => {
    open({ stickConnected: false });
    fireEvent.click(screen.getByRole('button', { name: '드럼 세팅' }));
    expect(screen.getByTestId('where').textContent).toBe('/setup');
  });

  it('「← 미니게임」 링크의 href가 /play/mini', () => {
    open();
    expect(screen.getByRole('link', { name: '← 미니게임' }).getAttribute('href')).toBe('/play/mini');
  });

  it('focusStart가 참이면 [시작하기]가 포커스를 받고, 아니면 받지 않는다', () => {
    open({ focusStart: true });
    expect(document.activeElement).toBe(startButton());
    cleanup();
    open();
    expect(document.activeElement).not.toBe(startButton());
  });
});

describe('MiniIntro 시작을 막는 사유(P2)', () => {
  it('blocked를 넘기면 [시작하기]가 disabled이고 눌러도 onStart가 불리지 않는다', () => {
    const { onStart } = open({ blocked: '음원을 받는 중이에요' });
    expect(startButton().disabled).toBe(true);
    fireEvent.click(startButton());
    expect(onStart).not.toHaveBeenCalled();
  });

  it('사유 문구와 [드럼 세팅]이 보이고, 스틱 연결 안내 줄 대신 사유가 보인다', () => {
    open({ blocked: '음원을 받는 중이에요', stickConnected: false });
    expect(screen.getByText('음원을 받는 중이에요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '드럼 세팅' })).toBeTruthy();
    expect(screen.queryByText('스틱이 연결돼 있지 않아요')).toBeNull();
  });

  it('스틱이 연결돼 있어도 사유가 있으면 사유와 [드럼 세팅]이 보인다', () => {
    open({ blocked: '음원을 받는 중이에요', stickConnected: true });
    expect(screen.getByText('음원을 받는 중이에요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '드럼 세팅' })).toBeTruthy();
  });

  it('blocked를 넘기지 않으면 막지 않는다', () => {
    open({ blocked: undefined });
    expect(startButton().disabled).toBe(false);
  });
});

describe('MiniIntro 사유에 딸린 버튼(P13)', () => {
  it('blockedAction을 넘기면 [드럼 세팅] 대신 그 버튼이 보이고 누르면 콜백이 불린다', () => {
    const onClick = vi.fn();
    open({ blocked: '박자를 먼저 맞춰 주세요', blockedAction: { label: '박자 맞추기', onClick } });
    expect(screen.queryByRole('button', { name: '드럼 세팅' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '박자 맞추기' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('blockedAction이 null이면 문구만 보이고 버튼이 없다', () => {
    const { container } = open({ blocked: '음원을 받는 중이에요', blockedAction: null });
    expect(screen.getByText('음원을 받는 중이에요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '드럼 세팅' })).toBeNull();
    expect(container.querySelectorAll('.mini-intro-msg button')).toHaveLength(0);
  });

  it('blocked 없이 blockedAction만 넘기면 쓰이지 않는다', () => {
    open({ blockedAction: { label: '박자 맞추기', onClick: vi.fn() } });
    expect(screen.queryByRole('button', { name: '박자 맞추기' })).toBeNull();
  });
});

describe('MiniIntro 조작과 안내 한 줄(P10·P12)', () => {
  it('controls를 넘기면 [시작하기] 줄에 보인다', () => {
    const { container } = open({ controls: <button type="button">힌트 켜기</button> });
    const row = container.querySelector('.mini-intro-cta');
    expect(row?.contains(screen.getByRole('button', { name: '힌트 켜기' }))).toBe(true);
    expect(row?.contains(startButton())).toBe(true);
  });

  it('note가 글이면 글만 보이고 버튼이 없다', () => {
    const { container } = open({ note: '박자 보정을 먼저 해 두면 좋아요' });
    expect(screen.getByText('박자 보정을 먼저 해 두면 좋아요')).toBeTruthy();
    expect(container.querySelectorAll('.mini-intro-actions > .mini-intro-msg button')).toHaveLength(0);
  });

  it('note가 { text, action }이면 글과 버튼이 보이고 버튼을 누르면 콜백이 불린다', () => {
    const onClick = vi.fn();
    open({ note: { text: '박자가 어긋나 있어요', action: { label: '박자 맞추기', onClick } } });
    expect(screen.getByText('박자가 어긋나 있어요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '박자 맞추기' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('넘기지 않으면 조작도 안내 한 줄도 없다', () => {
    const { container } = open();
    expect(container.querySelector('.mini-intro-cta')?.children).toHaveLength(1);
    expect(container.querySelector('.mini-intro-actions > .mini-intro-msg')).toBeNull();
  });
});
