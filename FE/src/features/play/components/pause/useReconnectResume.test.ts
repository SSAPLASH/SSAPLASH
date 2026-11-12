// 재연결 뒤 자동 재개 컨트롤러 검증. 렌더 라이브러리가 없어 훅 대신 컨트롤러를 가짜 타이머로 돌린다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PauseReason } from './PauseOverlay';
import { createReconnectResume, type ResumeCountValue } from './useReconnectResume';

const GO_MS = 400;

function setup() {
  const log: string[] = [];
  const ctrl = createReconnectResume(() => ({
    setPauseReason: (r: PauseReason | null) => log.push(`reason:${r}`),
    setCountValue: (v: ResumeCountValue | null) => log.push(`count:${v}`),
    resume: () => log.push('resume'),
    pauseTo: (r: PauseReason) => log.push(`pauseTo:${r}`),
    goMs: GO_MS,
  }));
  return { ctrl, log };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createReconnectResume', () => {
  it('끊김 상태에서 ready가 아니면 아무것도 하지 않는다', () => {
    const { ctrl, log } = setup();
    ctrl.update('disconnected', false);
    vi.advanceTimersByTime(10_000);
    expect(log).toEqual([]);
  });

  it('disconnected → ready: reconnected → 1초 뒤 null + 3·2·1·go → resume', () => {
    const { ctrl, log } = setup();
    ctrl.update('disconnected', true);
    expect(log).toEqual(['reason:reconnected']);
    ctrl.update('reconnected', true);

    vi.advanceTimersByTime(999);
    expect(log).toEqual(['reason:reconnected']);
    vi.advanceTimersByTime(1);
    expect(log.slice(1)).toEqual(['reason:null', 'count:3']);
    expect(ctrl.isResuming()).toBe(true);
    ctrl.update(null, true);

    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(log.slice(3)).toEqual(['count:2', 'count:1', 'count:go']);
    expect(log).not.toContain('resume');

    vi.advanceTimersByTime(GO_MS);
    expect(log.slice(-2)).toEqual(['count:null', 'resume']);
    expect(ctrl.isResuming()).toBe(false);
  });

  it('reconnected 중 ready가 false로 떨어지면 타이머를 지우고 disconnected로 되돌린다', () => {
    const { ctrl, log } = setup();
    ctrl.update('disconnected', true);
    ctrl.update('reconnected', true);
    vi.advanceTimersByTime(500);
    ctrl.update('reconnected', false);
    expect(log).toEqual(['reason:reconnected', 'reason:disconnected']);
    vi.advanceTimersByTime(10_000);
    expect(log).toHaveLength(2);
  });

  it('카운트다운 중 ready가 false로 떨어지면 타이머를 지우고 pauseTo(disconnected)', () => {
    const { ctrl, log } = setup();
    ctrl.update('disconnected', true);
    ctrl.update('reconnected', true);
    vi.advanceTimersByTime(1000);
    ctrl.update(null, true);
    vi.advanceTimersByTime(1000); // 2
    ctrl.update(null, false);
    expect(log.slice(-2)).toEqual(['count:null', 'pauseTo:disconnected']);
    const n = log.length;
    vi.advanceTimersByTime(10_000);
    expect(log).toHaveLength(n);
    expect(log).not.toContain('resume');
    expect(ctrl.isResuming()).toBe(false);
  });

  it('카운트다운 중 다른 일시정지가 걸리면(끊김 트리거) 카운트다운만 지운다', () => {
    const { ctrl, log } = setup();
    ctrl.update('disconnected', true);
    ctrl.update('reconnected', true);
    vi.advanceTimersByTime(1000);
    ctrl.update(null, true);
    ctrl.update('disconnected', false);
    expect(log.slice(-1)).toEqual(['count:null']);
    vi.advanceTimersByTime(10_000);
    expect(log).not.toContain('resume');
    expect(log.filter((l) => l.startsWith('pauseTo'))).toEqual([]);
    // 다시 돌아오면 같은 흐름이 처음부터
    ctrl.update('disconnected', true);
    expect(log.slice(-1)).toEqual(['reason:reconnected']);
  });

  it('reconnected 중 페이지가 reason을 바꾸면(나가기 등) 타이머를 정리한다', () => {
    const { ctrl, log } = setup();
    ctrl.update('disconnected', true);
    ctrl.update(null, true);
    vi.advanceTimersByTime(10_000);
    expect(log).toEqual(['reason:reconnected']);
  });

  it('dispose는 진행 중인 타이머를 지운다', () => {
    const { ctrl, log } = setup();
    ctrl.update('disconnected', true);
    ctrl.update('reconnected', true);
    vi.advanceTimersByTime(1000);
    ctrl.update(null, true);
    ctrl.dispose();
    vi.advanceTimersByTime(10_000);
    expect(log).toEqual(['reason:reconnected', 'reason:null', 'count:3']);
  });

  it('user·menu 일시정지는 ready여도 건드리지 않는다', () => {
    const { ctrl, log } = setup();
    ctrl.update('user', true);
    ctrl.update('menu', true);
    vi.advanceTimersByTime(10_000);
    expect(log).toEqual([]);
  });
});

describe('createReconnectResume 재정렬 보류(PLAY-004 D12)', () => {
  it('1초 뒤 realignPending이면 카드를 둔 채(realigning) 기다리고, 꺼지면 카운트다운 → resume', () => {
    const { ctrl, log } = setup();
    ctrl.update('disconnected', true, false);
    ctrl.update('reconnected', true, true); // 프롬프트가 떴다
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(['reason:reconnected']); // 카운트다운 보류, 카드 유지
    expect(ctrl.isResuming()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(log).toEqual(['reason:reconnected']);
    // 스네어를 쳤거나 [건너뛰기]
    ctrl.update('reconnected', true, false);
    expect(log.slice(1)).toEqual(['reason:null', 'count:3']);
    expect(ctrl.isResuming()).toBe(true);
    ctrl.update(null, true, false);
    vi.advanceTimersByTime(3000 + GO_MS);
    expect(log.slice(-2)).toEqual(['count:null', 'resume']);
  });

  it('realignPending이 아니면(방향 유지 재연결) 기존대로 1초 뒤 바로 카운트다운', () => {
    const { ctrl, log } = setup();
    ctrl.update('disconnected', true, false);
    ctrl.update('reconnected', true, false);
    vi.advanceTimersByTime(1000);
    expect(log.slice(1)).toEqual(['reason:null', 'count:3']);
  });

  it('realigning 중 ready가 떨어지면 끊김 카드로, 페이지가 reason을 바꾸면 접는다', () => {
    const { ctrl, log } = setup();
    ctrl.update('disconnected', true, true);
    ctrl.update('reconnected', true, true);
    vi.advanceTimersByTime(1000);
    ctrl.update('reconnected', false, true);
    expect(log.slice(-1)).toEqual(['reason:disconnected']);
    expect(ctrl.isResuming()).toBe(false);
    ctrl.update('disconnected', true, true);
    ctrl.update('reconnected', true, true);
    vi.advanceTimersByTime(1000);
    ctrl.update(null, true, true); // 나가기 등
    vi.advanceTimersByTime(10_000);
    expect(log).not.toContain('resume');
  });
});
