// @vitest-environment happy-dom
// 리포트 화면 구역 (설계 COACH-002 리포트 화면 개편 A2~A9): 전체 노트 흐름 · 선택 구간 확대 · 관찰 목록 · 패드별 기록 · 분석 상태 안내
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UseSegmentPlayer } from './useSegmentPlayer';
import type { PadId } from '@/domain/kit/pads';
import type { PadStat, Report, ReportNote, WeakSegment } from '@/domain/play/report';
import { flowBins, focusOfBin, focusOfCluster, focusOfTransition, type ReportGrid } from '@/features/result/domain/reportView';
import { FocusPanel } from './FocusPanel';
import { NoteFlowChart } from './NoteFlowChart';
import { AnalysisNotice, ObservationList, PadTable, StatsLine } from './ReportSections';

afterEach(cleanup);

let seq = 0;
const note = (timeMs: number, pad: PadId, judgement: ReportNote['judgement'] = 'PERFECT', deltaMs: number | null = 0): ReportNote => ({
  seq: seq++,
  noteId: null,
  timeMs,
  pad,
  judgement,
  deltaMs: judgement === 'MISS' ? null : deltaMs,
  velocity: null,
});
const cluster = (over: Partial<WeakSegment> = {}): WeakSegment => ({
  fromMs: 12300,
  toMs: 17300,
  pattern: 'MISS_CLUSTER',
  description: '이 구간에서 노트를 많이 놓쳐요.',
  causeTags: [],
  pads: ['RIDE'],
  severity: 0.8,
  scope: 'SEGMENT',
  metrics: { missRate: 1, missCount: 3, noteCount: 3 },
  ...over,
});
const NOTES = [
  note(1000, 'KICK'),
  note(13340, 'RIDE', 'MISS'),
  note(14790, 'RIDE', 'MISS'),
  note(15530, 'HIHAT', 'MISS'),
  note(46000, 'KICK', 'GOOD', -39),
  note(46240, 'SNARE', 'MISS'),
  note(46480, 'HIHAT', 'PERFECT', 13),
];

/** BPM 120·4박·원점 0 — 한 마디 2초 */
const GRID: ReportGrid = { bpm: 120, beatsPerBar: 4, originMs: 0 };

function fakePlayer(over: Partial<UseSegmentPlayer> = {}): UseSegmentPlayer {
  return { playingKey: null, rate: 1, loop: false, play: vi.fn(), stop: vi.fn(), toggleRate: vi.fn(), toggleLoop: vi.fn(), ...over };
}

describe('NoteFlowChart', () => {
  const draw = (props: Partial<Parameters<typeof NoteFlowChart>[0]> = {}) => {
    const onPickBin = vi.fn();
    const onPickCluster = vi.fn();
    const c = cluster();
    render(<NoteFlowChart bins={flowBins(NOTES, 60000)} totalMs={60000} clusters={[c]} focus={focusOfCluster(c)} onPickBin={onPickBin} onPickCluster={onPickCluster} {...props} />);
    return { onPickBin, onPickCluster, c };
  };

  it('5초 칸마다 막대 버튼이 있고 이름에 시각과 판정 수가 든다(A2)', () => {
    draw();
    expect(screen.getAllByRole('button', { name: /^\d+:\d\d–\d+:\d\d: / })).toHaveLength(12);
    expect(screen.getByRole('button', { name: '0:10–0:15: 정확 0, 빠름 0, 늦음 0, 놓침 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '0:45–0:50: 정확 1, 빠름 1, 늦음 0, 놓침 1' })).toBeTruthy();
    expect(screen.getByLabelText('0:00부터 1:00까지 5초 단위 노트 판정 분포')).toBeTruthy();
  });

  it('막대에 초점을 주면 그 5초의 요약이 뜨고, 벗어나면 사라진다(A2)', () => {
    draw();
    const bin = screen.getByRole('button', { name: /^0:45–0:50/ });
    fireEvent.focus(bin);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('0:45–0:50');
    expect(tip.textContent).toContain('총 3개');
    expect(tip.textContent).toContain('정확 1');
    expect(tip.textContent).toContain('빠름 1');
    expect(tip.textContent).toContain('늦음 0');
    expect(tip.textContent).toContain('놓침 1');
    fireEvent.blur(bin);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('노트가 없는 칸의 요약은 「노트 없음」', () => {
    draw();
    fireEvent.focus(screen.getByRole('button', { name: /^0:30–0:35/ }));
    expect(screen.getByRole('tooltip').textContent).toContain('노트 없음');
  });

  it('막대를 누르면 그 칸의 시작 시각을 알린다', () => {
    const { onPickBin } = draw();
    fireEvent.click(screen.getByRole('button', { name: /^0:45–0:50/ }));
    expect(onPickBin).toHaveBeenCalledWith(45000);
  });

  it('놓친 구간 버튼: 시각과 놓친 수, 지금 확대 중이면 눌린 상태, 누르면 그 구간을 알린다(A3)', () => {
    const { onPickCluster, c } = draw();
    const marker = within(screen.getByLabelText('놓친 노트가 모인 구간')).getByRole('button');
    expect(marker.textContent).toBe('0:12.3–0:17.33개 놓침');
    expect(marker.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(marker);
    expect(onPickCluster).toHaveBeenCalledWith(c);
  });

  it('놓친 수가 없으면 시각만, 다른 구간을 확대 중이면 눌리지 않은 상태', () => {
    const c = cluster({ metrics: {} });
    draw({ clusters: [c], focus: focusOfBin(45000) });
    const marker = within(screen.getByLabelText('놓친 노트가 모인 구간')).getByRole('button');
    expect(marker.textContent).toBe('0:12.3–0:17.3');
    expect(marker.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /^0:45–0:50/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('범례는 정확 · 빠름·늦음 · 놓침 — 막대는 색 3개 그대로다(D5)', () => {
    const { container } = render(<NoteFlowChart bins={flowBins(NOTES, 60000)} totalMs={60000} clusters={[]} focus={null} onPickBin={() => {}} onPickCluster={() => {}} />);
    expect([...within(screen.getByLabelText('판정 범례')).getAllByText(/./)].map((e) => e.textContent)).toEqual(['정확', '빠름·늦음', '놓침']);
    expect(container.querySelector('.rp-bin')!.querySelectorAll('span')).toHaveLength(3);
    expect(container.textContent).not.toContain('타이밍 차이');
  });

  it('마디 격자가 있으면 놓친 구간 버튼의 시각 앞에 마디가 붙는다. 5초 칸의 이름은 시각만이다(D8)', () => {
    draw({ grid: GRID });
    const marker = within(screen.getByLabelText('놓친 노트가 모인 구간')).getByRole('button');
    expect(marker.textContent).toBe('7~9마디 · 0:12.3–0:17.33개 놓침');
    expect(screen.getByRole('button', { name: '0:10–0:15: 정확 0, 빠름 0, 늦음 0, 놓침 2' })).toBeTruthy();
  });

  it('칸이 많은 긴 곡은 칸 사이 간격을 줄인다', () => {
    const gap = (totalMs: number) => {
      const { container } = render(<NoteFlowChart bins={flowBins([], totalMs)} totalMs={totalMs} clusters={[]} focus={null} onPickBin={() => {}} onPickCluster={() => {}} />);
      const v = (container.querySelector('.rp-bars') as HTMLElement).style.getPropertyValue('--rp-gap');
      cleanup();
      return v;
    };
    expect(gap(180_000)).toBe('3px');
    expect(gap(600_000)).toBe('1px');
    expect(gap(1_200_000)).toBe('0px');
  });

  it('놓친 구간이 없으면 버튼 줄이 없고, 안내가 있으면 그 자리에 보인다(A3)', () => {
    draw({ clusters: [], focus: null, notice: <p>뚜렷한 약점이 발견되지 않았어요</p> });
    expect(screen.queryByLabelText('놓친 노트가 모인 구간')).toBeNull();
    expect(screen.getByText('뚜렷한 약점이 발견되지 않았어요')).toBeTruthy();
  });
});

describe('FocusPanel', () => {
  it('놓친 구간: 큰 제목·근거·AI 문구와 패드 줄의 노트 표시(A4)', () => {
    const c = cluster({ detail: '라이드 박자를 세면서 쳐 보세요.', tip: '0.75배로 먼저 들어 보세요.' });
    const { container } = render(<FocusPanel focus={focusOfCluster(c)} notes={NOTES} player={fakePlayer()} accompanimentUrl={null} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('0:12–0:17놓친 노트 확인');
    expect(screen.getByText('노트 3개 중 3개 놓침 · 100%')).toBeTruthy();
    expect(screen.getByText('이 구간에서 노트를 많이 놓쳐요.')).toBeTruthy();
    expect(screen.getByText('라이드 박자를 세면서 쳐 보세요.')).toBeTruthy();
    expect(screen.getByText('0.75배로 먼저 들어 보세요.')).toBeTruthy();
    // 패드 줄: 구간 안에 노트가 있는 패드만, 관련 패드는 굵게
    const lanes = [...container.querySelectorAll('.rp-lane-name')];
    expect(lanes.map((l) => l.textContent)).toEqual(['하이햇', '라이드']);
    expect(lanes.map((l) => l.classList.contains('related'))).toEqual([false, true]);
    expect(container.querySelectorAll('.rp-mark.miss')).toHaveLength(3);
    // 놓친 구간은 「확대 구간」 머리 줄을 두지 않는다(목업)
    expect(container.querySelector('.rp-detail-header')).toBeNull();
  });

  it('노트를 하나씩 넘겨 본다: 처음·끝에서는 버튼이 눌리지 않는다(A5)', () => {
    const { container } = render(<FocusPanel focus={focusOfCluster(cluster())} notes={NOTES} player={fakePlayer()} accompanimentUrl={null} />);
    const prev = screen.getByRole('button', { name: '이전 노트' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: '다음 노트' }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByText('0:13.34 · 라이드 · 놓침')).toBeTruthy();
    fireEvent.click(next);
    fireEvent.click(next);
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(screen.getByText('0:15.53 · 하이햇 · 놓침')).toBeTruthy();
    expect(next.disabled).toBe(true);
    expect(container.querySelectorAll('.rp-mark.current')).toHaveLength(1);
    // 노트 표시를 직접 눌러도 고른다
    fireEvent.click(screen.getByLabelText('0:14.79 라이드 놓침'));
    expect(screen.getByText('2 / 3')).toBeTruthy();
  });

  it('전환 예시: 제목은 패드 이름, 창 안 판정 요약과 오차를 읽어 준다(A4·A5)', () => {
    const t = cluster({ pattern: 'TRANSITION_MISS', pads: ['KICK', 'SNARE'], fromMs: 1000, toMs: 50000, description: '킥에서 스네어로 넘어갈 때 98%를 놓쳐요.', metrics: { transitionCount: 58, missCount: 57, missRate: 0.98 } });
    render(<FocusPanel focus={focusOfTransition(t, NOTES)} notes={NOTES} player={fakePlayer()} accompanimentUrl={null} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('킥 → 스네어전환 연습');
    expect(screen.getByText('전환 58번 중 57번 놓침 · 98%')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('구간 예시 0:46–0:54');
    expect(screen.getByText('3개 노트')).toBeTruthy();
    expect(screen.getByText('구간 내 판정: 정확 1 · 빠름 1 · 늦음 0 · 놓침 1')).toBeTruthy();
    // 빠름·늦음은 오차 글자가 방향을 말하므로 이름을 따로 쓰지 않는다(D6)
    expect(screen.getByText('0:46.00 · 킥 · 39ms 빠름')).toBeTruthy();
  });

  it('타이밍이 어긋난 노트는 빠름 ◀ · 늦음 ▶로 나눠 그리고 읽어 준다(D3·D4)', () => {
    const notes = [note(10200, 'SNARE', 'GOOD', -39), note(11000, 'SNARE', 'GOOD', 41), note(12000, 'SNARE', 'PERFECT', 12), note(13000, 'KICK', 'MISS')];
    const { container } = render(<FocusPanel focus={focusOfBin(10000)} notes={notes} player={fakePlayer()} accompanimentUrl={null} />);
    expect(container.querySelectorAll('.rp-mark.early')).toHaveLength(1);
    expect(container.querySelectorAll('.rp-mark.late')).toHaveLength(1);
    expect(container.querySelectorAll('.rp-mark.perfect')).toHaveLength(1);
    expect(container.querySelectorAll('.rp-mark.miss')).toHaveLength(1);
    expect(container.querySelector('.rp-mark.good')).toBeNull();
    expect(screen.getByLabelText('0:10.20 스네어 빠름').classList.contains('early')).toBe(true);
    expect(screen.getByLabelText('0:11.00 스네어 늦음').classList.contains('late')).toBe(true);
    expect(screen.getByText('구간 내 판정: 정확 1 · 빠름 1 · 늦음 1 · 놓침 1')).toBeTruthy();
    expect(screen.getByText('정확 ● · 빠름 ◀ · 늦음 ▶ · 놓침 ×')).toBeTruthy();
    // 고른 노트 한 줄: 빠름 → 늦음 → 정확 → 놓침
    expect(screen.getByText('0:10.20 · 스네어 · 39ms 빠름')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다음 노트' }));
    expect(screen.getByText('0:11.00 · 스네어 · 41ms 늦음')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다음 노트' }));
    expect(screen.getByText('0:12.00 · 스네어 · 정확 · 12ms 늦음')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다음 노트' }));
    expect(screen.getByText('0:13.00 · 킥 · 놓침')).toBeTruthy();
    expect(container.textContent).not.toContain('타이밍 차이');
  });

  it('마디 격자가 있으면 제목과 구간 줄에 마디가 붙는다(D8)', () => {
    render(<FocusPanel focus={focusOfCluster(cluster())} notes={NOTES} player={fakePlayer()} accompanimentUrl={null} grid={GRID} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('7~9마디 · 0:12–0:17놓친 노트 확인');
    cleanup();
    const t = cluster({ pattern: 'TRANSITION_MISS', pads: ['KICK', 'SNARE'], fromMs: 1000, toMs: 50000, metrics: { transitionCount: 58, missCount: 57, missRate: 0.98 } });
    render(<FocusPanel focus={focusOfTransition(t, NOTES)} notes={NOTES} player={fakePlayer()} accompanimentUrl={null} grid={GRID} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('킥 → 스네어전환 연습');
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('구간 예시 24~27마디 · 0:46–0:54');
  });

  it('정답 듣기: 확대 창 범위를 재생하고, 재생 중이면 정지로 바뀐다(A6)', () => {
    const f = focusOfCluster(cluster());
    const p = fakePlayer();
    const { rerender } = render(<FocusPanel focus={f} notes={NOTES} player={p} accompanimentUrl="https://x/acc.wav" />);
    fireEvent.click(screen.getByRole('button', { name: '정답 듣기' }));
    expect(p.play).toHaveBeenCalledTimes(1);
    const [key, plan, url] = vi.mocked(p.play).mock.calls[0];
    expect(key).toBe(f.key);
    expect(plan).toMatchObject({ fromMs: 12300, toMs: 17300 });
    expect(plan.events).toHaveLength(3);
    expect(url).toBe('https://x/acc.wav');
    const playing = fakePlayer({ playingKey: f.key });
    rerender(<FocusPanel focus={f} notes={NOTES} player={playing} accompanimentUrl={null} />);
    fireEvent.click(screen.getByRole('button', { name: '정지' }));
    expect(playing.stop).toHaveBeenCalled();
  });

  it('배속·반복: 눌린 쪽이 표시되고, 다른 배속을 누를 때만 바꾼다(A6)', () => {
    const p = fakePlayer({ rate: 0.75, loop: true });
    render(<FocusPanel focus={focusOfCluster(cluster())} notes={NOTES} player={p} accompanimentUrl={null} />);
    expect(screen.getByRole('button', { name: '0.75배' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '1배' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: '반복' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '0.75배' }));
    expect(p.toggleRate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '1배' }));
    expect(p.toggleRate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '반복' }));
    expect(p.toggleLoop).toHaveBeenCalledTimes(1);
  });

  it('노트를 아직 못 받았거나 창에 노트가 없으면 안내하고 정답 듣기는 눌리지 않는다', () => {
    const { rerender } = render(<FocusPanel focus={focusOfCluster(cluster())} notes={null} player={fakePlayer()} accompanimentUrl={null} />);
    expect(screen.getByText('노트를 불러오는 중…')).toBeTruthy();
    expect((screen.getByRole('button', { name: '정답 듣기' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<FocusPanel focus={focusOfBin(30000)} notes={NOTES} player={fakePlayer()} accompanimentUrl={null} />);
    expect(screen.getByText('이 구간에는 노트가 없습니다.')).toBeTruthy();
    expect((screen.getByRole('button', { name: '정답 듣기' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('패널이 사라지면 재생을 멈춘다', () => {
    const p = fakePlayer();
    const { unmount } = render(<FocusPanel focus={focusOfCluster(cluster())} notes={NOTES} player={p} accompanimentUrl={null} />);
    unmount();
    expect(p.stop).toHaveBeenCalled();
  });
});

describe('ObservationList', () => {
  it('줄마다 이름·횟수와 버튼, 누르면 알린다(A7)', () => {
    const onClick = vi.fn();
    render(
      <ObservationList
        id="t"
        title="패드 전환 관찰"
        rows={[
          { key: 'a', label: '킥 → 스네어', count: '전환 58번 중 57번 놓침 · 98%', action: { text: '0:46–0:54 예시 보기', onClick, pressed: false } },
          { key: 'b', label: '전반적으로 늦게 쳐요.', count: '연주 전체' },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: '패드 전환 관찰' })).toBeTruthy();
    expect(screen.getByText('전환 58번 중 57번 놓침 · 98%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '0:46–0:54 예시 보기' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('줄이 없으면 구역이 없다(A7)', () => {
    const { container } = render(<ObservationList id="t" title="패드 전환 관찰" rows={[]} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('PadTable · StatsLine', () => {
  const stat = (pad: PadId, accuracy: number | null, total: number, meanDeltaMs: number | null): PadStat => ({
    pad, accuracy, meanDeltaMs, meanVelocity: null, counts: { PERFECT: total, GOOD: 0, MISS: 0 }, sampleCount: total,
  });

  it('3줄 + 「다른 패드 N개 보기」, 평균 타이밍은 빠름·늦음, 없으면 —(A8)', () => {
    const { container } = render(
      <PadTable stats={[stat('RIDE', 0.487, 53, 8), stat('SNARE', 0.207, 88, -5), stat('CRASH', 0, 10, null), stat('HIHAT', 0.352, 369, -16), stat('KICK', 0.552, 162, 2)]} />,
    );
    const rows = [...container.querySelectorAll('.rp-pad-table')[0].querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows).toEqual([
      ['스네어', '20.7%', '88', '5ms 빠름'],
      ['하이햇', '35.2%', '369', '16ms 빠름'],
      ['킥', '55.2%', '162', '2ms 늦음'],
    ]);
    expect(screen.getByText('다른 패드 2개 보기')).toBeTruthy();
    const more = [...screen.getByLabelText('다른 패드 기록').querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(more).toEqual([
      ['라이드', '48.7%', '53', '8ms 늦음'],
      ['크래시', '0%', '10', '—'],
    ]);
  });

  it('패드 통계가 없으면 안내', () => {
    render(<PadTable stats={[]} />);
    expect(screen.getByText('패드 통계가 없습니다.')).toBeTruthy();
  });

  it('요약 수치 한 줄: 정확도·최대 콤보·점수·판정 노트(A1)', () => {
    const report = { accuracy: 0.383, maxCombo: 24, score: 26320, counts: { PERFECT: 200, GOOD: 100, MISS: 387 } } as Report;
    render(<StatsLine report={report} />);
    const text = screen.getByLabelText('연주 요약').textContent;
    expect(text).toBe('정확도38.3%최대 콤보24점수26,320판정 노트687');
  });
});

describe('AnalysisNotice', () => {
  const base = { segments: null, counts: { PERFECT: 30, GOOD: 0, MISS: 0 }, polling: 'idle' as const, onRefresh: () => {} };

  it('분석 상태마다 안내 문구(A9)', () => {
    const cases: [Parameters<typeof AnalysisNotice>[0], string][] = [
      [{ ...base, status: 'PENDING' }, 'AI가 연주를 분석하고 있어요'],
      [{ ...base, status: 'FAILED' }, '이번 연주의 AI 분석을 만들지 못했어요'],
      [{ ...base, status: 'NOT_REQUESTED' }, '이 연주는 AI 분석 대상이 아니에요'],
      [{ ...base, status: 'DONE' }, '분석 결과가 없어요'],
      [{ ...base, status: 'DONE', segments: [] }, '뚜렷한 약점이 발견되지 않았어요'],
      [{ ...base, status: 'DONE', segments: [], counts: { PERFECT: 5, GOOD: 0, MISS: 0 } }, '곡이 짧아 분석하지 않았어요'],
    ];
    for (const [props, text] of cases) {
      render(<AnalysisNotice {...props} />);
      expect(screen.getByText(text)).toBeTruthy();
      cleanup();
    }
  });

  it('재조회를 다 쓰면 새로고침 버튼(A9)', () => {
    const onRefresh = vi.fn();
    render(<AnalysisNotice {...base} status="PENDING" polling="exhausted" onRefresh={onRefresh} />);
    expect(screen.getByText('아직 분석 중이에요. 잠시 뒤 다시 확인해 주세요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('약점이 있으면 안내가 없다', () => {
    const { container } = render(<AnalysisNotice {...base} status="DONE" segments={[cluster()]} />);
    expect(container.innerHTML).toBe('');
  });
});
