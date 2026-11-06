// CalibrationStage SSR 검증(PLAY-004 4-1, UX-64): 보정 중 빈 킷 + 유령 목표 + 큰 안내 + 오른쪽 카드([다시][다음|저장]), 끝난 패드 표시, 경고, 재정렬 변형.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { CalibrationStage } from './CalibrationStage';
import { previewRadius } from './captureRadius';
import { IDLE_CALIBRATION, useLive, type CalibrationSnapshot } from '@/store/liveStore';
import { CAPTURE_ORDER, type CaptureSnapshot } from '@/engine/HitCapture';
import { DEFAULT_SENSOR_TUNING } from '@/domain/tuning';

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

const anchor = (pad: 'SNARE' | 'HIHAT' | 'RIDE', pitch: number, yaw: number) => ({ pad, pitch, yaw, radius: 0, samples: 2, spread: 1 });

function capture(over: Partial<CaptureSnapshot> = {}, target: CalibrationSnapshot['target'] = 'active'): CalibrationSnapshot {
  const cap: CaptureSnapshot = {
    phase: 'capturing',
    hands: [0, 1],
    order: [...CAPTURE_ORDER],
    index: 1,
    target: 'HIHAT',
    counts: [1, 0],
    captured: { SNARE: [anchor('SNARE', -20, -5), anchor('SNARE', -20, 5)] },
    warning: null,
    lastAccepted: null,
    radiusOverrides: {},
    ...over,
  };
  return { mode: 'capture', capture: cap, realign: null, hands: cap.hands, target };
}

describe('CalibrationStage 보정 중', () => {
  it('킷 전체는 어둡고(dim) 목표 패드만 켜진다(lit). 큰 안내·카드 제목·타격 줄', () => {
    putLive({ calibration: capture() });
    const html = renderToStaticMarkup(<CalibrationStage />);
    expect(html).toContain('data-testid="cal-stage-capture"');
    expect(html).toContain('<p class="cal-stage-headline">하이햇을 2번 타격하세요</p>');
    expect(html).toContain('하이햇 2회 타격 (2/7)');
    expect(html).toContain('왼 1/2 · 오 0/2');
    expect((html.match(/drum-pad-lit/g) ?? []).length).toBe(1);
    const after = html.slice(html.indexOf('class="drum-pad-lit"'));
    const nextDim = after.indexOf('drum-pad-dim');
    expect(after.indexOf('>하이햇<')).toBeLessThan(nextDim === -1 ? Infinity : nextDim);
    expect((html.match(/drum-pad-dim/g) ?? []).length).toBe(7); // 8패드 중 켜진 하이햇만 제외
    expect(html).toContain('>스네어<'); // 끝난 패드도 그대로 보인다(어둡게)
    expect(html).toContain('>라이드<');
    expect(html).not.toContain('drum-pad-ghost');
    expect(html).toContain('보정 중');
  });

  it('2타 전에는 [다음]이 비활성이고 위치는 –, 확인 대기(padDone)면 활성이고 위치 X·Y·Z가 cm로 보인다', () => {
    putLive({ calibration: capture() });
    let html = renderToStaticMarkup(<CalibrationStage />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>다음</);
    expect(html).toContain('<dd>–</dd>');
    putLive({
      calibration: capture({ phase: 'padDone', counts: [2, 2], captured: { SNARE: [anchor('SNARE', -20, -5), anchor('SNARE', -20, 5)], HIHAT: [anchor('HIHAT', 0, -40), anchor('HIHAT', 0, -30)] } }),
    });
    html = renderToStaticMarkup(<CalibrationStage />);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>다음</);
    expect(html).toContain('왼 2/2 · 오 2/2');
    expect(html).not.toContain('<dd>–</dd>');
    expect(html).toContain('>다시</button>');
  });

  it('마지막 패드는 [다음] 대신 [저장]', () => {
    putLive({ calibration: capture({ index: 6, target: 'RIDE', phase: 'padDone', counts: [2, 2], captured: { RIDE: [anchor('RIDE', 10, 40), anchor('RIDE', 10, 30)] } }) });
    const html = renderToStaticMarkup(<CalibrationStage onSave={() => {}} />);
    expect(html).toContain('라이드 2회 타격 (7/7)');
    expect(html).toContain('>저장</button>');
    expect(html).not.toContain('>다음</button>');
  });

  it('반지름 슬라이더: 사용자 값이 있으면 그 값, 없으면 자동값(앵커 하나면 상한)', () => {
    const t = DEFAULT_SENSOR_TUNING;
    const cap = capture().capture!;
    expect(previewRadius(cap, 'HIHAT', t)).toBe(t.maxRadiusDeg); // 아직 못 잡음
    expect(previewRadius(cap, 'SNARE', t)).toBe(t.maxRadiusDeg); // 앵커 하나뿐
    expect(previewRadius({ ...cap, radiusOverrides: { HIHAT: 20 } }, 'HIHAT', t)).toBe(20);
    expect(previewRadius({ ...cap, radiusOverrides: { HIHAT: 99 } }, 'HIHAT', t)).toBe(t.maxRadiusDeg);
    putLive({ calibration: capture({ radiusOverrides: { HIHAT: 20 } }) });
    expect(renderToStaticMarkup(<CalibrationStage />)).toContain('20°');
  });

  it('퍼짐 경고 문구', () => {
    putLive({ calibration: capture({ warning: { pad: 'HIHAT', stickId: 0, spread: 12.2 } }) });
    const html = renderToStaticMarkup(<CalibrationStage />);
    expect(html).toContain('두 번 친 자리가 너무 달라요(12°). 왼손으로 하이햇을 다시 쳐 주세요');
  });

  it('한 손만 대상이면 그 손 문구와 한 숫자 타격 줄', () => {
    putLive({ calibration: capture({ hands: [1], counts: [0, 0] }) });
    const html = renderToStaticMarkup(<CalibrationStage />);
    expect(html).toContain('하이햇을 오른손으로 2번 타격하세요');
    expect(html).toContain('<dd>0/2</dd>');
  });
});

describe('CalibrationStage 재정렬', () => {
  it('스네어 유령 + 프롬프트 + [처음부터 보정]', () => {
    putLive({ calibration: { mode: 'realign', capture: null, realign: { hands: [0], done: [false, false], finished: false }, hands: [0], target: null } });
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

describe('CalibrationStage 패드 단위 재보정(T9)', () => {
  it('order가 한 패드면 그 패드만 켜지고 나머지는 어둡다. 진행 점은 1개, 버튼은 [저장]', () => {
    putLive({ calibration: capture({ order: ['HIHAT'], index: 0, target: 'HIHAT', counts: [0, 0], captured: {} }) });
    const html = renderToStaticMarkup(<CalibrationStage />);
    expect(html).toContain('>스네어<');
    expect(html).toContain('>라이드<');
    expect((html.match(/drum-pad-lit/g) ?? []).length).toBe(1);
    expect(html).toContain('0 / 1 패드 완료');
    expect(html).toContain('하이햇 2회 타격 (1/1)');
    expect(html).toContain('>저장</button>');
  });
});
