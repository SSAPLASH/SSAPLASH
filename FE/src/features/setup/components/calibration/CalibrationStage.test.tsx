// @vitest-environment happy-dom
// CalibrationStage 검증(PLAY-004 4-1, 개편 D2·D3·D6·D10·D11·D14, v0.2 · SETUP-fixed-kit-noir): 진행 중(버튼 없음)·자동 진행 대기·간격 경고 배너([◯◯ 다시], 스냅샷 기준으로 사라짐)·
// 결과 화면(겹침 테두리·겹침 문구·base 포함 겹침·[◯◯ 다시]·저장)·재정렬. 정보 카드·패드 선택·반지름 슬라이더는 고정 배치 개편으로 없어졌다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ redo: vi.fn(), next: vi.fn(), skipRealign: vi.fn() }));
vi.mock('@/runtime/calibrationSession', () => ({ calibrationSession: h }));

import { CalibrationStage } from './CalibrationStage';
import { IDLE_CALIBRATION, useLive, type CalibrationSnapshot } from '@/store/liveStore';
import { CAPTURE_ORDER, type CaptureSnapshot } from '@/engine/HitCapture';
import type { PadId } from '@/domain/kit/pads';

const anchor = (pad: PadId, pitch: number, yaw: number) => ({ pad, pitch, yaw, radius: 0, samples: 2, spread: 1 });
/** 양손이 같은 자리를 친 앵커 */
const both = (pad: PadId, pitch: number, yaw: number): [ReturnType<typeof anchor>, ReturnType<typeof anchor>] => [anchor(pad, pitch, yaw), anchor(pad, pitch, yaw)];

/** 하이햇(-40°)과 크래시(-32°)는 8° 떨어져 20° 미만, 나머지는 멀다 */
const CLOSE = { HIHAT: both('HIHAT', 0, -40), CRASH: both('CRASH', 0, -32) };
const ALL = {
  ...CLOSE,
  SNARE: both('SNARE', -20, 0),
  SMALL_TOM: both('SMALL_TOM', 10, 20),
  MID_TOM: both('MID_TOM', 10, 50),
  FLOOR_TOM: both('FLOOR_TOM', -30, 60),
  RIDE: both('RIDE', 20, 80),
};

function setCapture(over: Partial<CaptureSnapshot> = {}, target: CalibrationSnapshot['target'] = 'active'): void {
  const cap: CaptureSnapshot = {
    phase: 'capturing',
    hands: [0, 1],
    targetHands: [0, 1],
    wrongHand: null,
    order: [...CAPTURE_ORDER],
    index: 1,
    target: 'CRASH',
    counts: [1, 0],
    captured: { HIHAT: both('HIHAT', 0, -40) },
    warning: null,
    gapWarnings: [],
    advancing: false,
    lastAccepted: null,
    radiusOverrides: {},
    base: [null, null],
    spreadStreak: [0, 0],
    gapHints: [],
    ...over,
  };
  useLive.setState({ calibration: { mode: 'capture', capture: cap, realign: null, hands: cap.hands, target } });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  useLive.setState({ calibration: IDLE_CALIBRATION });
});

describe('CalibrationStage 보정 진행', () => {
  it('킷 전체는 어둡고(dim) 목표 패드만 켜진다(lit). 큰 안내·진행 점·손별 타격 점이 보이고 버튼은 없다', () => {
    setCapture();
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('[data-testid="cal-stage-capture"]')).not.toBeNull();
    expect(container.querySelector('.cal-stage-headline')?.textContent).toBe('크래시를 양손으로 2번씩 타격하세요');
    expect(container.querySelector('[aria-label="1 / 7 패드 완료"]')).not.toBeNull();
    expect(container.querySelector('.cal-stage-pad')?.textContent).toBe('크래시');
    expect(container.querySelector('[aria-label="왼손 1/2"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="오른손 0/2"]')).not.toBeNull();
    // 하이햇 페달까지 9패드 중 목표 하나만 켜진다. 심벌(크래시·라이드·하이햇)은 받침 층·원판 층 두 그룹이라 클래스가 둘씩 붙는다
    expect(container.querySelectorAll('.drum-pad-lit').length).toBe(2);
    expect(container.querySelectorAll('.drum-pad-dim').length).toBe(10);
    expect(container.querySelector('.drum-pad-ghost')).toBeNull();
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('자동 진행 대기(padDone·advancing) 중에도 버튼이 없다. 타격 점은 다 찬 상태', () => {
    setCapture({ phase: 'padDone', advancing: true, counts: [2, 2], captured: { HIHAT: both('HIHAT', 0, -40), CRASH: both('CRASH', 0, 0) } });
    const { container } = render(<CalibrationStage />);
    expect(container.querySelectorAll('button').length).toBe(0);
    expect(container.querySelector('[aria-label="왼손 2/2"]')).not.toBeNull();
  });

  it('한 손만 대상이면 그 손 문구와 그 손 타격 점만', () => {
    setCapture({ hands: [1], targetHands: [1], counts: [0, 0] });
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('.cal-stage-headline')?.textContent).toBe('크래시를 오른손으로 2번 타격하세요');
    expect(container.querySelectorAll('.cal-hand-row').length).toBe(1);
    expect(container.querySelector('[aria-label="오른손 0/2"]')).not.toBeNull();
  });

  it('라이드 단계(PLAY-004 ①): 큰 문구에 오른손, 타수 점은 오른손 줄만. 다 친 패드로 센다', () => {
    setCapture({ index: 6, target: 'RIDE', targetHands: [1], counts: [0, 1], captured: { ...CLOSE, SNARE: both('SNARE', -20, 0) } });
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('.cal-stage-headline')?.textContent).toBe('라이드를 오른손으로 2번 타격하세요');
    expect(container.querySelectorAll('.cal-hand-row').length).toBe(1);
    expect(container.querySelector('[aria-label="오른손 1/2"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="왼손 0/2"]')).toBeNull();
  });

  it('라이드는 오른손 앵커만 있어도 끝난 패드로 센다(done 화면의 진행 점)', () => {
    const rideRight: CaptureSnapshot['captured'] = { ...ALL, RIDE: [undefined, anchor('RIDE', 20, 80)] };
    setCapture({ phase: 'done', index: 6, target: null, targetHands: [], counts: [0, 0], captured: rideRight });
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('[aria-label="7 / 7 패드 완료"]')).not.toBeNull();
  });

  it('다른 손으로 쳤으면 2초 동안 「라이드는 오른손으로 쳐요」를 힌트 자리에 보인다', () => {
    setCapture({ index: 6, target: 'RIDE', targetHands: [1], wrongHand: { pad: 'RIDE', stickId: 0, at: performance.now() } });
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('.cal-stage-hint')?.textContent).toBe('라이드는 오른손으로 쳐요');
  });

  it('다른 손 힌트는 2초가 지나면 사라진다', async () => {
    setCapture({ index: 6, target: 'RIDE', targetHands: [1], wrongHand: { pad: 'RIDE', stickId: 0, at: performance.now() - 1990 } });
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('.cal-stage-hint')?.textContent).toBe('라이드는 오른손으로 쳐요');
    await waitFor(() => expect(container.querySelector('.cal-stage-hint')).toBeNull());
  });

  it('퍼짐 경고 문구', () => {
    setCapture({ warning: { pad: 'CRASH', stickId: 0, spread: 12.2 } });
    render(<CalibrationStage />);
    expect(screen.getByText('두 번 친 자리가 너무 달라요(12°). 왼손으로 크래시를 다시 쳐 주세요')).toBeTruthy();
  });

  it('패드 단위 재보정(T9): order가 한 패드면 진행 점 1개, 그 패드만 켜진다', () => {
    setCapture({ order: ['HIHAT'], index: 0, target: 'HIHAT', counts: [0, 0], captured: {} });
    const { container } = render(<CalibrationStage />);
    expect(container.querySelectorAll('.drum-pad-lit').length).toBe(2); // 하이햇은 받침 층·원판 층
    expect(container.querySelector('[aria-label="0 / 1 패드 완료"]')).not.toBeNull();
  });
});

describe('CalibrationStage 간격 경고 배너(D3, v0.2)', () => {
  const warnCap = (over: Partial<CaptureSnapshot> = {}): Partial<CaptureSnapshot> => ({
    phase: 'capturing',
    index: 2,
    target: 'SNARE',
    counts: [0, 0],
    captured: CLOSE,
    gapWarnings: [{ stickId: 0, pad: 'CRASH', near: 'HIHAT', deg: 10.3 }],
    ...over,
  });

  it('멈추지 않는다: 다음 패드를 기다리는 capturing에서 경고 머리·안내·[크래시 다시] 배너가 뜬다', () => {
    setCapture(warnCap());
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('[aria-label="2 / 7 패드 완료"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="gap-banner-progress"]')).not.toBeNull();
    expect(screen.getByText('왼손 크래시가 하이햇과 10°밖에 안 떨어져 있어요')).toBeTruthy();
    expect(screen.getByText('크래시는 스틱 끝을 더 높이 들고 바깥쪽으로, 하이햇은 앞쪽 아래로 쳐 보세요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '크래시 다시' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '다음' })).toBeNull();
    expect(screen.queryByRole('button', { name: '결과 보기' })).toBeNull();
  });

  it('자동 진행 대기(padDone·advancing) 중에도 배너를 보인다', () => {
    setCapture(warnCap({ phase: 'padDone', advancing: true, index: 1, target: 'CRASH', counts: [2, 2] }));
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('[data-testid="gap-banner-progress"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: '크래시 다시' })).toBeTruthy();
  });

  it('[◯◯ 다시]는 그 패드를 redo한다', () => {
    setCapture(warnCap());
    render(<CalibrationStage />);
    fireEvent.click(screen.getByRole('button', { name: '크래시 다시' }));
    expect(h.redo).toHaveBeenCalledWith('CRASH');
  });

  it('손마다 경고·안내 문구를 따로 보이되 [다시] 버튼은 패드마다 하나', () => {
    setCapture(
      warnCap({
        gapWarnings: [
          { stickId: 0, pad: 'CRASH', near: 'HIHAT', deg: 10 },
          { stickId: 1, pad: 'CRASH', near: 'HIHAT', deg: 12 },
        ],
      }),
    );
    render(<CalibrationStage />);
    expect(screen.getByText('왼손 크래시가 하이햇과 10°밖에 안 떨어져 있어요')).toBeTruthy();
    expect(screen.getByText('오른손 크래시가 하이햇과 12°밖에 안 떨어져 있어요')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '크래시 다시' }).length).toBe(1);
  });

  it('다음 타격이 수락돼 엔진이 gapWarnings를 비운 스냅샷이면 배너가 사라진다', () => {
    setCapture(warnCap());
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('[data-testid="gap-banner-progress"]')).not.toBeNull();
    act(() => setCapture(warnCap({ gapWarnings: [], counts: [1, 0] })));
    expect(container.querySelector('[data-testid="gap-banner-progress"]')).toBeNull();
  });

  it('경고가 없으면 배너가 없다', () => {
    setCapture();
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('.cal-gap-banner')).toBeNull();
  });
});

describe('CalibrationStage 결과 화면(D6·D11)', () => {
  const doneCap = (over: Partial<CaptureSnapshot> = {}): Partial<CaptureSnapshot> => ({ phase: 'done', index: 6, target: null, counts: [0, 0], captured: ALL, ...over });

  it('「7곳 모두 잡았어요」, 20° 미만 쌍에 --warn 테두리·겹침 문구·[◯◯ 다시]·[저장]', () => {
    setCapture(doneCap());
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('.cal-stage-headline')?.textContent).toBe('7곳 모두 잡았어요');
    const warn = [...container.querySelectorAll('[data-warn-pad]')].map((e) => e.getAttribute('data-warn-pad'));
    expect(warn.sort()).toEqual(['CRASH', 'HIHAT']);
    // 양손이 같은 쌍으로 겹치면 한 쌍으로 센다
    const lines = [...container.querySelectorAll('.cal-result-overlaps .cal-overlap-line')].map((e) => e.textContent);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^하이햇과 크래시가 너무 가까워요\(\d+°\)$/);
    expect(screen.getByRole('button', { name: '하이햇 다시' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '크래시 다시' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '저장' })).toBeTruthy();
    expect(container.querySelector('[data-testid="gap-banner-progress"]')).toBeNull();
    expect(container.querySelector('.drum-pad-dim')).toBeNull(); // 결과 화면은 어둡게 하지 않는다
  });

  it('겹침이 없으면 테두리·겹침 문구·[다시] 버튼이 없고 [저장]만 남는다', () => {
    setCapture(doneCap({ captured: { ...ALL, CRASH: both('CRASH', 0, 100) } }));
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('[data-warn-pad]')).toBeNull();
    expect(container.querySelector('.cal-overlap-line')).toBeNull();
    expect(screen.queryByRole('button', { name: /다시$/ })).toBeNull();
    expect(screen.getByRole('button', { name: '저장' })).toBeTruthy();
  });

  it('D14: 패드 하나만 다시 보정해도 세션 밖 앵커(base)와의 겹침이 문구·테두리에 보인다. 세션 밖 패드끼리의 쌍은 제외', () => {
    // 세션은 크래시만. base: 왼손 하이햇이 크래시와 8° 거리, 스네어와 미드탐이 서로 8° 거리(세션 밖끼리)
    const base: CaptureSnapshot['base'] = [
      { HIHAT: anchor('HIHAT', 0, -40), SNARE: anchor('SNARE', -20, 0), MID_TOM: anchor('MID_TOM', -20, 8) },
      null,
    ];
    setCapture(doneCap({ order: ['CRASH'], index: 0, hands: [0], captured: { CRASH: [anchor('CRASH', 0, -32), undefined] }, base }));
    const { container } = render(<CalibrationStage />);
    const warn = [...container.querySelectorAll('[data-warn-pad]')].map((e) => e.getAttribute('data-warn-pad'));
    expect(warn.sort()).toEqual(['CRASH', 'HIHAT']);
    expect(container.querySelectorAll('.cal-result-overlaps .cal-overlap-line')).toHaveLength(1);
    expect(container.querySelector('.cal-result-overlaps')?.textContent).toMatch(/^(하이햇과 크래시가|크래시와 하이햇이) 너무 가까워요\(\d+°\)$/);
  });

  it('D14: 세션 패드와 base 패드가 같은 패드면 base 값은 쓰지 않는다(옛 자리와 겹침 없음)', () => {
    const base: CaptureSnapshot['base'] = [{ HIHAT: anchor('HIHAT', 0, -40), CRASH: anchor('CRASH', 0, -38) }, null];
    setCapture(doneCap({ order: ['CRASH'], index: 0, hands: [0], captured: { CRASH: [anchor('CRASH', 0, 60), undefined] }, base }));
    const { container } = render(<CalibrationStage />);
    expect(container.querySelector('[data-warn-pad]')).toBeNull();
    expect(container.querySelector('.cal-overlap-line')).toBeNull();
  });

  it('[◯◯ 다시]는 그 패드를 redo, [저장]은 onSave', () => {
    const onSave = vi.fn();
    setCapture(doneCap());
    render(<CalibrationStage onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '크래시 다시' }));
    expect(h.redo).toHaveBeenCalledWith('CRASH');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('CalibrationStage 재정렬', () => {
  it('스네어 유령 + 프롬프트 + [처음부터 보정]', () => {
    useLive.setState({ calibration: { mode: 'realign', capture: null, realign: { hands: [0], done: [false, false], finished: false }, hands: [0], target: null } });
    const { container } = render(<CalibrationStage onRestart={() => {}} />);
    expect(container.querySelector('[data-testid="cal-stage-realign"]')).not.toBeNull();
    expect(screen.getByText('왼손으로 스네어를 한 번 쳐 주세요')).toBeTruthy();
    expect(screen.getByText('건너뛰기')).toBeTruthy();
    expect(screen.getByText('처음부터 보정')).toBeTruthy();
  });

  it('idle이면 아무것도 그리지 않는다', () => {
    useLive.setState({ calibration: IDLE_CALIBRATION });
    const { container } = render(<CalibrationStage />);
    expect(container.innerHTML).toBe('');
  });
});
