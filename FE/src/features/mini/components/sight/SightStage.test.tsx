// @vitest-environment happy-dom
// SightStage·ProblemDots 렌더 검증: 값만 받는 화면이라 props를 바꿔 가며 음표·이름·문구·값 캡슐·눈금과 문제 영역의 속성(단계·속도 단계·알림)을 읽는다.
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

const problem = () => screen.getByTestId('mini-sight-problem');
const average = () => screen.getByTestId('mini-sight-average').textContent;
const wrongs = () => screen.getByTestId('mini-sight-wrongs').textContent;
const ring = () => document.querySelector('.mini-sight-ring');
const penalty = () => document.querySelector('.mini-sight-penalty');

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

describe('SightStage 값 캡슐', () => {
  it('답이 없으면 평균은 「–」, 틀림 0', () => {
    stage();
    expect(average()).toBe('–');
    expect(wrongs()).toBe('0');
  });

  it('평균은 끝난 문제의 평균(10ms 단위)이다', () => {
    stage({ answers: [ok('SNARE', 300), ok('KICK', 400), ok('RIDE', 504)], step: 'wait' });
    // (300 + 400 + 504) / 3 = 401.3 → 400
    expect(average()).toBe('0.40초');
  });

  it('틀림은 끝난 문제의 틀림과 지금 문제의 틀림을 더한다', () => {
    const answers: SightAnswer[] = [{ pad: 'SNARE', ms: 900, wrongs: 2, timedOut: false }, ok('KICK')];
    stage({ answers, step: 'shown', wrongs: 1 });
    expect(wrongs()).toBe('3');
  });

  it('확인 중에는 지금 문제의 틀림을 또 더하지 않는다', () => {
    const answers: SightAnswer[] = [{ pad: 'SNARE', ms: 900, wrongs: 2, timedOut: false }];
    stage({ answers, step: 'hold', wrongs: 2 });
    expect(wrongs()).toBe('2');
  });

  it('대기 중에는 끝난 문제의 틀림만 보인다', () => {
    stage({ answers: [{ pad: 'SNARE', ms: 900, wrongs: 2, timedOut: false }], step: 'wait', wrongs: 0 });
    expect(wrongs()).toBe('2');
  });
});

describe('SightStage 무대', () => {
  it('[그만하기]가 onQuit을 부른다', () => {
    const onQuit = vi.fn();
    stage({ onQuit });
    fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('머리 줄 보조 글이 힌트를 따르고 누를 수 없는 힌트 조작은 없다', () => {
    stage({ hint: 'off' });
    expect(screen.getByTestId('mini-sight-sub').textContent).toBe('힌트 끔 · 10문제');
    expect(screen.queryByRole('radio')).toBeNull();
    cleanup();
    stage({ hint: 'on' });
    expect(screen.getByTestId('mini-sight-sub').textContent).toBe('힌트 켬 · 10문제');
  });

  it('빛줄기는 카운트다운 동안 꺼져 있고 플레이에서 켜진다', () => {
    stage({ phase: 'countdown', countdown: 3 });
    expect(document.querySelector('.free-lights')?.className).not.toContain('is-on');
    cleanup();
    stage();
    expect(document.querySelector('.free-lights')?.className).toContain('is-on');
  });

  it('카운트다운은 본문이 아니라 무대 바로 아래에 겹친다(무대 한가운데)', () => {
    stage({ phase: 'countdown', countdown: 3 });
    expect(document.querySelector('.mini-stage > .play-countdown')).toBeTruthy();
  });

  it('렌즈는 오선 틀 안에 있고 낭독기에서 숨긴다', () => {
    stage();
    const lens = document.querySelector('.mini-sight-staff > .mini-sight-lens');
    expect(lens?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.mini-sight-staff .lesson-solo-staff')).toBeTruthy();
  });
});

describe('SightStage 문제 영역의 속성', () => {
  it('data-step은 카운트다운 idle, 그 밖에는 문제 상태다', () => {
    stage({ phase: 'countdown', countdown: 3, step: 'shown' });
    expect(problem().getAttribute('data-step')).toBe('idle');
    for (const step of ['wait', 'shown'] as const) {
      cleanup();
      stage({ step });
      expect(problem().getAttribute('data-step')).toBe(step);
    }
    cleanup();
    stage({ step: 'hold', answers: [ok('SNARE')] });
    expect(problem().getAttribute('data-step')).toBe('hold');
  });

  it('확인 중에만 방금 문제의 속도 단계가 붙는다', () => {
    stage({ step: 'shown' });
    expect(problem().hasAttribute('data-grade')).toBe(false);
    const cases: [SightAnswer, string][] = [
      [ok('SNARE', 480), 'fast'],
      [ok('SNARE', 820), 'good'],
      [ok('SNARE', 1340), 'slow'],
      [{ pad: 'SNARE', ms: 900, wrongs: 1, timedOut: false }, 'bad'],
    ];
    for (const [answer, grade] of cases) {
      cleanup();
      stage({ step: 'hold', answers: [answer] });
      expect(problem().getAttribute('data-grade')).toBe(grade);
    }
    // 다음 문제의 대기로 넘어가면 떼어 낸다
    cleanup();
    stage({ step: 'wait', answers: [ok('SNARE', 480)] });
    expect(problem().hasAttribute('data-grade')).toBe(false);
  });

  it('시간 초과는 bad이고 시간 초과 표시가 붙으며 고리가 없다', () => {
    stage({ step: 'hold', answers: [{ pad: 'SNARE', ms: 5000, wrongs: 0, timedOut: true }] });
    expect(problem().getAttribute('data-grade')).toBe('bad');
    expect(problem().hasAttribute('data-timeout')).toBe(true);
    expect(ring()).toBeNull();
    cleanup();
    stage({ step: 'hold', answers: [ok('SNARE')] });
    expect(problem().hasAttribute('data-timeout')).toBe(false);
  });

  it('알림 속성은 대기 중의 early와 제시 중의 wrong에만 붙는다', () => {
    stage({ step: 'wait', notice: 'early' });
    expect(problem().getAttribute('data-notice')).toBe('early');
    cleanup();
    stage({ step: 'shown', notice: 'wrong', wrongs: 1 });
    expect(problem().getAttribute('data-notice')).toBe('wrong');
    cleanup();
    // 맞힌 뒤에 남은 틀림 알림은 확인·대기에서 보이지 않는다
    stage({ step: 'hold', notice: 'wrong', answers: [{ pad: 'SNARE', ms: 900, wrongs: 1, timedOut: false }] });
    expect(problem().hasAttribute('data-notice')).toBe(false);
    cleanup();
    stage({ step: 'wait', notice: 'wrong' });
    expect(problem().hasAttribute('data-notice')).toBe(false);
    cleanup();
    stage({ step: 'wait' });
    expect(problem().hasAttribute('data-notice')).toBe(false);
  });
});

describe('SightStage 울림 고리와 벌점', () => {
  const base: StageProps = { phase: 'playing', countdown: null, hint: 'on', total: 10, answers: [], step: 'shown', pad: 'SNARE', shownAt: null, wrongs: 0, notice: null, onQuit: () => undefined };

  it('대기에는 고리가 없고, 음표가 뜨면 생기며, 맞히면 is-hit 고리로 바뀐다', () => {
    const view = stage({ step: 'wait' });
    expect(ring()).toBeNull();
    view.rerender(<SightStage {...base} />);
    const shown = ring();
    expect(shown).toBeTruthy();
    expect(shown?.classList.contains('is-hit')).toBe(false);
    expect(shown?.getAttribute('aria-hidden')).toBe('true');
    // 틀려도 같은 고리다(다시 재생하지 않는다)
    view.rerender(<SightStage {...base} wrongs={1} notice="wrong" />);
    expect(ring()).toBe(shown);
    view.rerender(<SightStage {...base} step="hold" answers={[ok('SNARE')]} />);
    expect(ring()).not.toBe(shown);
    expect(ring()?.classList.contains('is-hit')).toBe(true);
  });

  it('카운트다운 중에는 제시 단계의 값이 들어와도 고리가 없다', () => {
    stage({ phase: 'countdown', countdown: 2, step: 'shown', pad: 'RIDE' });
    expect(ring()).toBeNull();
  });

  it('벌점 표시는 제시 중 틀린 횟수가 있을 때만 있고, 틀릴 때마다 새 요소다', () => {
    const view = render(<SightStage {...base} />);
    expect(penalty()).toBeNull();
    view.rerender(<SightStage {...base} wrongs={1} notice="wrong" />);
    const first = penalty();
    expect(first?.textContent).toBe('+0.5');
    expect(first?.getAttribute('aria-hidden')).toBe('true');
    view.rerender(<SightStage {...base} wrongs={2} notice="wrong" />);
    expect(penalty()).not.toBe(first);
    // 맞히면 사라진다
    view.rerender(<SightStage {...base} step="hold" wrongs={2} answers={[{ pad: 'SNARE', ms: 1900, wrongs: 2, timedOut: false }]} />);
    expect(penalty()).toBeNull();
  });
});

describe('ProblemDots', () => {
  it('섞인 답에서 ok·bad·now·rest를 정하고 「4 / 10」을 보인다', () => {
    render(
      <ProblemDots
        total={10}
        answers={[
          { ms: 400, wrongs: 0, timedOut: false },
          { ms: 1900, wrongs: 2, timedOut: false },
          { ms: 5000, wrongs: 0, timedOut: true },
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
    render(<ProblemDots total={10} answers={Array.from({ length: 10 }, () => ({ ms: 400, wrongs: 0, timedOut: false }))} />);
    expect(dots()).toEqual(Array(10).fill('ok'));
    expect(screen.getByTestId('mini-sight-count').textContent).toBe('10 / 10');
  });

  it('끝난 칸에만 속도 단계가 붙는다', () => {
    render(
      <ProblemDots
        total={6}
        answers={[
          { ms: 480, wrongs: 0, timedOut: false },
          { ms: 820, wrongs: 0, timedOut: false },
          { ms: 1340, wrongs: 0, timedOut: false },
          { ms: 700, wrongs: 1, timedOut: false },
        ]}
      />,
    );
    const grades = Array.from(document.querySelectorAll('.mini-sight-dot')).map((el) => el.getAttribute('data-grade'));
    expect(grades).toEqual(['fast', 'good', 'slow', 'bad', null, null]);
  });

  it('점은 낭독기에서 숨기고 total만큼 그린다', () => {
    render(<ProblemDots total={4} answers={[]} />);
    expect(document.querySelector('.mini-sight-dots')?.getAttribute('aria-hidden')).toBe('true');
    expect(dots()).toHaveLength(4);
  });
});
