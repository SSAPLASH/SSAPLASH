// CalibrationStage SSR 검증(PLAY-004 4-1): 보정 중 빈 킷 + 유령 목표 + 카운트 문구, 끝난 패드 표시, 경고, 재정렬 변형.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { CalibrationStage } from './CalibrationStage';
import { IDLE_CALIBRATION, useLive, type CalibrationSnapshot } from '@/store/liveStore';
import type { CaptureSnapshot } from '@/engine/HitCapture';

// zustand v5는 서버 렌더에서 getInitialState()를 읽으므로 초기 상태 객체에 넣고 끝나면 되돌린다
const restores: Array<() => void> = [];
function putLive(patch: Record<string, unknown>): void {
  const initial = useLive.getInitialState() as unknown as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    const prev = initial[key];
    restores.push(() => {
      initial[key] = prev;
    });
  }
  Object.assign(initial, patch);
  useLive.setState(patch);
}
afterEach(() => {
  while (restores.length) restores.pop()?.();
});

const anchor = (pad: 'SNARE' | 'HIHAT', pitch: number, yaw: number) => ({ pad, pitch, yaw, radius: 0, samples: 2, spread: 1 });

function capture(over: Partial<CaptureSnapshot> = {}): CalibrationSnapshot {
  const cap: CaptureSnapshot = {
    phase: 'capturing',
    hands: [0, 1],
    index: 1,
    target: 'HIHAT',
    counts: [1, 0],
    captured: { SNARE: [anchor('SNARE', -20, -5), anchor('SNARE', -20, 5)] },
    warning: null,
    lastAccepted: null,
    ...over,
  };
  return { mode: 'capture', capture: cap, realign: null, hands: cap.hands };
}

describe('CalibrationStage 보정 중', () => {
  it('목표 패드는 유령, 끝난 패드는 보이고, 안 잡은 패드는 숨긴다. 카운트 문구', () => {
    putLive({ calibration: capture() });
    const html = renderToStaticMarkup(<CalibrationStage />);
    expect(html).toContain('data-testid="cal-stage-capture"');
    expect(html).toContain('하이햇을 양손으로 2번씩 쳐 주세요');
    expect(html).toContain('왼손 1/2');
    expect(html).toContain('오른손 0/2');
    expect(html).toContain('drum-pad-ghost');
    expect(html).toContain('>스네어<'); // 끝난 패드
    expect(html).not.toContain('>라이드<'); // 아직
    expect(html).toContain('>킥<'); // 페달은 흐리게
    expect(html).toContain('drum-pad-faded');
    expect(html).toContain('취소');
  });

  it('퍼짐 경고 문구', () => {
    putLive({ calibration: capture({ warning: { pad: 'HIHAT', stickId: 0, spread: 12.2 } }) });
    const html = renderToStaticMarkup(<CalibrationStage />);
    expect(html).toContain('두 번 친 자리가 너무 달라요(12°). 왼손으로 하이햇을 다시 쳐 주세요');
  });

  it('한 손만 대상이면 그 손 문구', () => {
    putLive({ calibration: capture({ hands: [1], counts: [0, 0] }) });
    expect(renderToStaticMarkup(<CalibrationStage />)).toContain('하이햇을 오른손으로 2번 쳐 주세요');
  });
});

describe('CalibrationStage 재정렬', () => {
  it('스네어 유령 + 프롬프트 + [처음부터 보정]', () => {
    putLive({ calibration: { mode: 'realign', capture: null, realign: { hands: [0], done: [false, false], finished: false }, hands: [0] } });
    const html = renderToStaticMarkup(<CalibrationStage onRestart={() => {}} />);
    expect(html).toContain('data-testid="cal-stage-realign"');
    expect(html).toContain('왼손으로 스네어를 한 번 쳐 주세요');
    expect(html).toContain('건너뛰기');
    expect(html).toContain('처음부터 보정');
  });

  it('idle이면 아무것도 그리지 않는다', () => {
    putLive({ calibration: IDLE_CALIBRATION });
    expect(renderToStaticMarkup(<CalibrationStage />)).toBe('');
  });
});
