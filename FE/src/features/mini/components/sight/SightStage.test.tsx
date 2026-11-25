// @vitest-environment happy-dom
// SightStage·ProblemDots 렌더 검증: 값만 받는 화면이라 props를 바꿔 가며 음표·이름·문구·칸·점을 읽는다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { ProblemDots } from '@/features/mini/components/sight/ProblemDots';
import { SightStage } from '@/features/mini/components/sight/SightStage';
import type { SightAnswer } from '@/features/mini/domain/sightRound';

vi.mock('@/components/drum/LiveDrumKit', () => ({
  LiveDrumKit: (props: { labels?: boolean; lit?: string }) => (
    <div data-testid="kit" data-labels={String(Boolean(props.labels))} data-lit={props.lit ?? ''} />
  ),
}));
vi.mock('@/components/drum/usePadStates', () => ({ usePadStates: () => ({}), usePadHitSeq: () => ({}) }));

afterEach(cleanup);

type StageProps = Parameters<typeof SightStage>[0];

const name = (pad: PadId) => PAD_META[pad].label;
const ok = (pad: PadId, ms = 400): SightAnswer => ({ pad, ms, wrongs: 0, timedOut: false });

function stage(over: Partial<StageProps> = {}) {
  const props: StageProps = {
    phase: 'playing',
    countdown: null,
    hint: 'on',
    total: 10,
    answers: [],
    step: 'wait',
    pad: 'SNARE',
    shownAt: null,
    wrongs: 0,
    notice: null,
    onQuit: () => undefined,
    ...over,
  };
  return render(<SightStage {...props} />);
}

const message = () => screen.getByTestId('mini-sight-message');
const hintName = () => screen.getByTestId('mini-sight-hint').textContent;
const notePad = () => document.querySelector('.lesson-solo-note')?.getAttribute('data-pad') ?? null;
const staffLabel = () => document.querySelector('.lesson-solo-staff svg')?.getAttribute('aria-label');
const kit = () => screen.getByTestId('kit');
const dots = () => Array.from(document.querySelectorAll('.mini-sight-dot')).map((el) => el.getAttribute('data-state'));

function cell(label: string): string | null {
  for (const dt of Array.from(document.querySelectorAll('.mini-cell-label'))) {
    if (dt.textContent === label) return dt.parentElement?.textContent ?? null;
  }
  return null;
}

describe('SightStage 카운트다운', () => {
  it('숫자 오버레이가 보이고 음표는 없고 문구는 「음표가 뜨면 바로 치세요.」다', () => {
    stage({ phase: 'countdown', countdown: 2, step: 'shown', pad: 'RIDE' });
    expect(document.querySelector('.play-countdown-value')?.textContent).toBe('2');
    // 카운트다운 중에는 제시 단계의 값이 들어와도 음표를 그리지 않는다
    expect(notePad()).toBeNull();
    expect(staffLabel()).toBe('빈 오선');
    expect(message().textContent).toBe('음표가 뜨면 바로 치세요.');
    expect(message().classList.contains('is-plain')).toBe(true);
    expect(hintName()).toBe('');
    expect(kit().getAttribute('data-lit')).toBe('');
  });

  it('카운트다운이 아니면 오버레이가 없다', () => {
    stage();
    expect(document.querySelector('.play-countdown-value')).toBeNull();
  });
});

describe('SightStage 문제 단계', () => {
  it('대기: 음표가 없고 빈 오선·이름 없음·불빛 없음', () => {
    stage({ step: 'wait' });
    expect(notePad()).toBeNull();
    expect(staffLabel()).toBe('빈 오선');
    expect(hintName()).toBe('');
    expect(kit().getAttribute('data-lit')).toBe('');
    expect(message().textContent).toBe('음표가 뜨면 바로 치세요.');
  });

  it('제시(힌트 켬): 음표·이름·「○○ 음표」·라벨 켬·불빛', () => {
    stage({ step: 'shown', pad: 'RIDE', hint: 'on' });
    expect(notePad()).toBe('RIDE');
    expect(hintName()).toBe(name('RIDE'));
    expect(staffLabel()).toBe(`${name('RIDE')} 음표`);
    expect(kit().getAttribute('data-labels')).toBe('true');
    expect(kit().getAttribute('data-lit')).toBe('RIDE');
    expect(message().textContent).toBe('이 음표의 패드를 치세요.');
  });

  it('제시(힌트 끔): 음표는 있지만 이름·악보 이름이 없고 라벨 끔·불빛 없음', () => {
    stage({ step: 'shown', pad: 'RIDE', hint: 'off' });
    expect(notePad()).toBe('RIDE');
    expect(hintName()).toBe('');
    expect(staffLabel()).toBe('음표');
    expect(kit().getAttribute('data-labels')).toBe('false');
    expect(kit().getAttribute('data-lit')).toBe('');
  });

  it('제시인데 패드가 없으면(문제를 다 냄) 음표도 불빛도 없다', () => {
    stage({ step: 'shown', pad: null });
    expect(notePad()).toBeNull();
    expect(kit().getAttribute('data-lit')).toBe('');
  });

  it('확인: 방금 끝난 문제의 음표와 이름이 힌트와 상관없이 보이고 불빛은 꺼진다', () => {
    for (const hint of ['on', 'off'] as const) {
      const { unmount } = stage({ step: 'hold', hint, pad: 'HIHAT', answers: [ok('KICK', 380)] });
      expect(notePad()).toBe('KICK');
      expect(hintName()).toBe(name('KICK'));
      expect(staffLabel()).toBe(`${name('KICK')} 음표`);
      expect(message().textContent).toBe(`${name('KICK')}, 맞았어요.`);
      expect(message().classList.contains('is-good')).toBe(true);
      expect(kit().getAttribute('data-lit')).toBe('');
      expect(document.querySelector('.mini-sight-clock')?.classList.contains('is-frozen')).toBe(true);
      expect(screen.getByTestId('mini-sight-clock').textContent).toBe('0.38');
      unmount();
    }
  });

  it('확인(시간 초과): 시간 초과 문구와 멈춘 5.00', () => {
    stage({ step: 'hold', answers: [{ pad: 'SNARE', ms: 5000, wrongs: 0, timedOut: true }] });
    expect(message().textContent?.startsWith('시간이 다 됐어요.')).toBe(true);
    expect(message().classList.contains('is-bad')).toBe(true);
    expect(screen.getByTestId('mini-sight-clock').textContent).toBe('5.00');
  });

  it('알림: 대기 중 early·제시 중 wrong 문구', () => {
    stage({ step: 'wait', notice: 'early' });
    expect(message().textContent).toBe('아직이에요. 음표가 뜬 뒤에 치세요.');
    expect(message().classList.contains('is-bad')).toBe(true);
    cleanup();
    stage({ step: 'shown', notice: 'wrong', wrongs: 1 });
    expect(message().textContent).toBe('틀렸어요. 0.5초가 더해졌어요.');
    expect(message().classList.contains('is-bad')).toBe(true);
  });

  it('마무리(closing)에서도 마지막 문제의 확인을 그대로 그린다', () => {
    stage({ phase: 'closing', step: 'hold', pad: null, answers: Array.from({ length: 10 }, () => ok('SNARE')) });
    expect(notePad()).toBe('SNARE');
    expect(message().textContent).toBe(`${name('SNARE')}, 맞았어요.`);
    expect(kit().getAttribute('data-lit')).toBe('');
  });

  it('불빛은 플레이 단계에서만 켠다(마무리에서는 제시 단계여도 끈다)', () => {
    stage({ phase: 'closing', step: 'shown', pad: 'RIDE', hint: 'on' });
    expect(kit().getAttribute('data-lit')).toBe('');
  });

  it('제시 시각이 없으면 시계가 멈춰 있고, 있으면 흐른다', () => {
    stage({ step: 'shown', shownAt: null });
    expect(document.querySelector('.mini-sight-clock')?.classList.contains('is-idle')).toBe(true);
    cleanup();
    stage({ step: 'shown', shownAt: performance.now() });
    expect(document.querySelector('.mini-sight-clock')?.classList.contains('is-running')).toBe(true);
  });
});

describe('SightStage 옆 칸', () => {
  it('답이 없으면 평균은 「–」, 0문제, 틀림 0번', () => {
    stage();
    const average = cell('지금까지 평균');
    expect(average).toContain('–');
    expect(average).toContain('0문제');
    expect(average).not.toContain('초');
    expect(cell('틀림')).toContain('0번');
  });

  it('평균은 끝난 문제의 평균(10ms 단위)과 문제 수를 보인다', () => {
    stage({ answers: [ok('SNARE', 300), ok('KICK', 400), ok('RIDE', 504)], step: 'wait' });
    const average = cell('지금까지 평균');
    // (300 + 400 + 504) / 3 = 401.3 → 400
    expect(average).toContain('0.40');
    expect(average).toContain('초');
    expect(average).toContain('3문제');
  });

  it('틀림은 끝난 문제의 틀림과 지금 문제의 틀림을 더한다', () => {
    const answers: SightAnswer[] = [{ pad: 'SNARE', ms: 900, wrongs: 2, timedOut: false }, ok('KICK')];
    stage({ answers, step: 'shown', wrongs: 1 });
    expect(cell('틀림')).toContain('3번');
  });

  it('확인 중에는 지금 문제의 틀림을 또 더하지 않는다', () => {
    const answers: SightAnswer[] = [{ pad: 'SNARE', ms: 900, wrongs: 2, timedOut: false }];
    stage({ answers, step: 'hold', wrongs: 2 });
    expect(cell('틀림')).toContain('2번');
  });

  it('대기 중에는 끝난 문제의 틀림만 보인다', () => {
    stage({ answers: [{ pad: 'SNARE', ms: 900, wrongs: 2, timedOut: false }], step: 'wait', wrongs: 0 });
    expect(cell('틀림')).toContain('2번');
  });
});

describe('SightStage 조작', () => {
  it('[그만하기]가 onQuit을 부른다', () => {
    const onQuit = vi.fn();
    stage({ onQuit });
    fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('힌트 라디오는 둘 다 꺼져 있고 선택은 hint를 따른다', () => {
    stage({ hint: 'off' });
    const on = screen.getByRole('radio', { name: '힌트 켬' }) as HTMLButtonElement;
    const off = screen.getByRole('radio', { name: '힌트 끔' }) as HTMLButtonElement;
    expect(on.disabled).toBe(true);
    expect(off.disabled).toBe(true);
    expect(on.getAttribute('aria-checked')).toBe('false');
    expect(off.getAttribute('aria-checked')).toBe('true');
    cleanup();
    stage({ hint: 'on' });
    expect(screen.getByRole('radio', { name: '힌트 켬' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: '힌트 끔' }).getAttribute('aria-checked')).toBe('false');
  });

  it('힌트 라디오를 눌러도 선택이 바뀌지 않는다', () => {
    stage({ hint: 'on' });
    fireEvent.click(screen.getByRole('radio', { name: '힌트 끔' }));
    expect(screen.getByRole('radio', { name: '힌트 켬' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('ProblemDots', () => {
  it('섞인 답에서 ok·bad·now·rest를 정하고 「4 / 10」을 보인다', () => {
    render(
      <ProblemDots
        total={10}
        answers={[
          { wrongs: 0, timedOut: false },
          { wrongs: 2, timedOut: false },
          { wrongs: 0, timedOut: true },
        ]}
      />,
    );
    expect(dots()).toEqual(['ok', 'bad', 'bad', 'now', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest']);
    expect(screen.getByTestId('mini-sight-count').textContent).toBe('4 / 10');
  });

  it('답이 없으면 첫 점이 now이고 「1 / 10」', () => {
    render(<ProblemDots total={10} answers={[]} />);
    expect(dots()[0]).toBe('now');
    expect(dots().filter((s) => s === 'rest')).toHaveLength(9);
    expect(screen.getByTestId('mini-sight-count').textContent).toBe('1 / 10');
  });

  it('열 문제를 다 냈으면 「10 / 10」이고 now가 없다', () => {
    render(<ProblemDots total={10} answers={Array.from({ length: 10 }, () => ({ wrongs: 0, timedOut: false }))} />);
    expect(dots()).toEqual(Array(10).fill('ok'));
    expect(screen.getByTestId('mini-sight-count').textContent).toBe('10 / 10');
  });

  it('점은 낭독기에서 숨기고 total만큼 그린다', () => {
    render(<ProblemDots total={4} answers={[]} />);
    expect(document.querySelector('.mini-sight-dots')?.getAttribute('aria-hidden')).toBe('true');
    expect(dots()).toHaveLength(4);
  });
});
