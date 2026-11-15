import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { MetronomePanel } from './MetronomePanel';

// zustand v5는 서버 렌더에서 getInitialState()를 읽으므로 초기 상태 객체에 값을 넣고 끝나면 되돌린다
const restores: Array<() => void> = [];
function patchLiveMetronome(patch: Partial<ReturnType<typeof useLive.getState>['metronome']>) {
  const init = useLive.getInitialState();
  const before = init.metronome;
  init.metronome = { ...before, ...patch };
  restores.push(() => {
    init.metronome = before;
  });
}
function patchSubdivision(value: 'auto' | 'quarter' | 'eighth') {
  const init = useSettings.getInitialState();
  const before = init.metronomeSubdivision;
  init.metronomeSubdivision = value;
  restores.push(() => {
    init.metronomeSubdivision = before;
  });
}
afterEach(() => {
  while (restores.length) restores.pop()!();
});

describe('MetronomePanel 마크업', () => {
  const html = renderToStaticMarkup(<MetronomePanel />);

  it('켜기 스위치와 BPM −/+는 패널에 없다(Dock 칩에만 있다)', () => {
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('BPM 5 감소');
    expect(html).not.toContain('BPM 5 증가');
    expect(html).not.toContain('metro-panel-bpm');
  });

  it('박자 선택은 3/4·4/4, 박 분할 선택은 자동·4분음표·8분음표', () => {
    expect(html).toMatch(/aria-label="박자"[^>]*>.*4\/4.*3\/4/);
    expect(html).toMatch(/aria-label="박 분할"[^>]*>.*자동.*4분음표.*8분음표/);
    expect((html.match(/role="radio"/g) ?? []).length).toBe(5);
  });

  it('음량 슬라이더와 탭 템포 버튼', () => {
    expect(html).toContain('type="range"');
    expect(html).toContain('메트로놈 음량');
    expect(html).toMatch(/ui-btn ui-btn-secondary ui-btn-sm[^>]*>탭 템포</);
  });

  it('자동이면 메트로놈 BPM으로 푼 문구와 박 무늬를 보인다(120 → 4분: 정박 4개)', () => {
    expect(html).toContain('지금 BPM에서는 4분음표로 울려요');
    expect(html).toMatch(/metro-panel-pattern" data-beats="4" data-subdivision="1"/);
    expect((html.match(/metro-pip beat/g) ?? []).length).toBe(4);
    expect(html).not.toContain('metro-pip sub');
  });

  it('BPM 90 미만이면 자동이 8분: 사이 박 점이 박마다 하나씩 낀다', () => {
    patchLiveMetronome({ bpm: 80, beatsPerBar: 3 });
    const slow = renderToStaticMarkup(<MetronomePanel />);
    expect(slow).toContain('지금 BPM에서는 8분음표로 울려요');
    expect(slow).toMatch(/data-beats="3" data-subdivision="2"/);
    expect((slow.match(/metro-pip beat/g) ?? []).length).toBe(3);
    expect((slow.match(/metro-pip sub/g) ?? []).length).toBe(3);
  });

  it('울리는 박(정박)의 점만 켜진다', () => {
    patchLiveMetronome({ playing: true, beat: 2 });
    const on = renderToStaticMarkup(<MetronomePanel />);
    expect((on.match(/metro-pip beat[^"]* on"/g) ?? []).length).toBe(1);
  });

  it('곡에 잠기면 박자·탭은 비활성이고 박 분할은 고를 수 있다. 풀이 문구는 곡 BPM(정수로 반올림)', () => {
    patchLiveMetronome({ locked: true, bpm: 78.43 });
    const locked = renderToStaticMarkup(<MetronomePanel />);
    expect(locked).toContain('metro-panel-seg disabled');
    expect(locked).toMatch(/ui-btn ui-btn-secondary ui-btn-sm[^>]*disabled[^>]*>탭 템포</);
    expect(locked).toContain('곡 연주 중에는 곡의 BPM·박자로 고정돼요');
    expect(locked).toContain('BPM 78 곡이라 8분음표로 울려요');
    expect(locked).not.toMatch(/<div class="subdiv disabled/);
  });

  it('4분·8분을 고르면 BPM과 무관한 문구', () => {
    patchSubdivision('eighth');
    expect(renderToStaticMarkup(<MetronomePanel />)).toContain('박 사이에 한 번 더 울려요');
  });

  it('리듬 게임(gameDisabled)이면 박자·탭·박 분할이 모두 비활성이고 안내가 있다', () => {
    const game = renderToStaticMarkup(<MetronomePanel gameDisabled />);
    expect(game).toContain('metro-panel-seg disabled');
    expect(game).toMatch(/ui-btn ui-btn-secondary ui-btn-sm[^>]*disabled[^>]*>탭 템포</);
    expect(game).toMatch(/<div class="subdiv disabled/);
    expect(game).toContain('리듬 게임에서는 메트로놈을 쓰지 않아요');
    // 기본(악보 등)에서는 비활성이 아니다
    expect(html).not.toContain('리듬 게임에서는');
  });
});
