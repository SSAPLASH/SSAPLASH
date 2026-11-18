import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { usePresets } from '@/store/presetStore';
import { SYSTEM_PRESET_ID, type KitPreset } from '@/domain/kit/preset';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import { CAPTURE_ORDER } from '@/engine/HitCapture';
import { SetupPage } from './SetupPage';

// useBlocker가 데이터 라우터를 요구하므로 정적 데이터 라우터로 렌더한다
async function renderSetup(): Promise<string> {
  const routes = [{ path: '/setup', element: <SetupPage /> }];
  const { query } = createStaticHandler(routes);
  const context = await query(new Request('http://localhost/setup'));
  if (context instanceof Response) throw new Error('unexpected redirect');
  const router = createStaticRouter(routes, context);
  return renderToStaticMarkup(<StaticRouterProvider router={router} context={context} />);
}

describe('SetupPage 고급 설정', () => {
  it('접힘 요약에 판정 타이밍·패드 인식 범위만 있고 앱 동작 값과 음량은 없다', async () => {
    const html = await renderSetup();
    expect(html).toContain('판정 타이밍 · 패드 인식 범위');
    expect(html).not.toContain('판정 폭');
    expect(html).not.toContain('노트 낙하');
    expect(html).not.toContain('카운트다운');
    expect(html).not.toContain('플레이 중 메트로놈');
    expect(html).not.toContain('전체 음량');
    expect(html).not.toContain('타격음 지연 보정');
    expect(html).not.toContain('오디오 오프셋');
  });
});

// zustand v5는 서버 렌더에서 getInitialState()를 읽으므로(setState가 반영되지 않는다) 초기 상태 객체에도 값을 넣고 끝나면 되돌린다
const restores: Array<() => void> = [];
function put(store: { getInitialState: () => unknown; setState: (p: never) => void }, patch: Record<string, unknown>): void {
  const initial = store.getInitialState() as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    const prev = initial[key];
    restores.push(() => {
      initial[key] = prev;
    });
  }
  Object.assign(initial, patch);
  store.setState(patch as never);
}
const putSettings = (patch: Record<string, unknown>) => put(useSettings, patch);
const putLive = (patch: Record<string, unknown>) => put(useLive, patch);
const putPresets = (items: KitPreset[]) => put(usePresets, { items });
afterEach(() => {
  while (restores.length) restores.pop()?.();
});

const preset = (id: string, name: string): KitPreset => ({
  id,
  name,
  isDefault: false,
  layout: DEFAULT_KIT_LAYOUT,
  soundSetId: 'ssaplash',
  schemaVersion: 1,
  createdAt: 't',
  updatedAt: 't',
});
const good = { pad: 'SNARE' as const, pitch: -20, yaw: 3, radius: 18, samples: 2, spread: 1 };

describe('SetupPage 페달 줄', () => {
  // 페달 줄은 「스틱 연결」 팝업 안에 있다(PLAY-004 D8). 팝업을 연 뒤 검증은 SetupPage.dialog.test.tsx에서 한다
  it('진입 시에는 팝업이 닫혀 있어 페이지에 페달 줄이 없다', async () => {
    putSettings({ sensorKind: 'webserial' });
    const html = await renderSetup();
    expect(html).not.toContain('setup-pedal');
    expect(html).not.toContain('role="dialog"');
  });
});

describe('SetupPage 단계 2개(UX-64)', () => {
  it('상단은 스틱 연결·시작 위치 보정 두 타일(StatusTile)이고 ③ 프리셋 카드가 없다', async () => {
    putSettings({ sensorKind: 'pointer' });
    putLive({ connected: [true, true] });
    const html = await renderSetup();
    expect(html).toContain('2단계 중');
    expect(html).toContain('시작 위치 보정');
    expect((html.match(/class="setup-tile is-on"/g) ?? []).length).toBe(2);
    expect(html).toContain('>연결됨<');
    expect(html).toContain('>보정됨<');
    expect(html).not.toContain('setup-step-mark');
    expect(html).not.toContain('step-preset');
    expect(html).not.toContain('새 프리셋으로 저장</button>'.replace('</button>', '')); // 하단 바에도 없다(시스템 기본은 저장 대상이 아님)
    expect(html).not.toContain('적용된 프리셋 없음');
  });
});

describe('SetupPage ② 시작 위치 보정(UX-64 D7)', () => {
  it('시스템 기본이면 앵커가 없어도 완료 요약(타일은 요약만)', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: SYSTEM_PRESET_ID });
    putLive({ connected: [true, true], referenceSetAt: null });
    const html = await renderSetup();
    expect(html).toContain('시스템 기본 배치 · 보정 없이 바로 칠 수 있어요');
    expect(html).not.toContain('보정 시작');
  });

  it('사용자 프리셋인데 앵커가 없으면 요약이 "드럼 위치를 아직 잡지 않았어요", 타일 버튼은 [보정하기]이고 팝업은 닫혀 있다', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: 'p1' });
    putPresets([preset('p1', '내 배치')]);
    putLive({ connected: [true, true] });
    const html = await renderSetup();
    expect(html).toContain('드럼 위치를 아직 잡지 않았어요');
    expect(html).toContain('>보정하기<');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('시작 위치 맞추기');
    expect(html).not.toContain('넓게');
  });

  it('양손 앵커가 있으면 완료 요약', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [{ SNARE: good }, { SNARE: good }], activePresetId: 'p1' });
    putPresets([preset('p1', '내 배치')]);
    putLive({ connected: [true, true], referenceSetAt: null });
    expect(await renderSetup()).toContain('보정했어요');
  });

  it('한 손만 보정한 채 다른 손이 붙으면 다시 "보정 필요"', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [{ SNARE: good }, null], activePresetId: 'p1' });
    putPresets([preset('p1', '내 배치')]);
    putLive({ connected: [true, true] });
    expect(await renderSetup()).toContain('드럼 위치를 아직 잡지 않았어요');
  });

  it('재정렬이 필요한 손이 있으면 요약이 그 손을 짚는다', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [{ SNARE: good }, { SNARE: good }], activePresetId: 'p1' });
    putPresets([preset('p1', '내 배치')]);
    putLive({ connected: [true, true], realignNeeded: [false, true] });
    expect(await renderSetup()).toContain('오른손 스틱이 다시 켜졌어요 · 스네어를 한 번 쳐 주세요');
  });
});

// 시스템 기본에서 스네어를 끌어 옮긴 배치(서버 렌더는 초기 상태를 읽으므로 movePad 대신 값을 넣는다)
const MOVED_LAYOUT = { ...DEFAULT_KIT_LAYOUT, SNARE: { ...DEFAULT_KIT_LAYOUT.SNARE, x: 0.7, y: 0.3 } };

describe('SetupPage 드럼 배치 카드 칩 줄(UX-64)', () => {
  it('시스템 기본 칩 + 저장 프리셋 칩 + 머리 줄 [다시 보정]·[새로 보정]. 시스템 기본이면 다시 보정이 비활성이고 고정 자리 안내가 보인다', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: SYSTEM_PRESET_ID });
    putPresets([preset('p1', '내 배치'), preset('p2', '재즈 연습')]);
    putLive({ connected: [true, true] });
    const html = await renderSetup();
    expect(html).toContain('시스템 기본 · 고정');
    expect(html).toContain('>내 배치</button>');
    expect(html).toContain('>재즈 연습</button>');
    expect(html).not.toContain('추가하기');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>다시 보정</);
    expect(html).toMatch(/<button[^>]*>새로 보정</);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>새로 보정</);
    expect(html).not.toContain('이 드럼 다시 치기');
    expect(html).not.toContain('기본 배치로');
    expect(html).toContain('기본 자리예요. 내 자리로 맞추려면 [새로 보정]을 눌러요.');
    expect(html).toContain('「시스템 기본」 사용 중');
  });

  it('내 드럼 무대는 카드 면 없이 고정 그림(setup-kit-zone)을 두고 정보 카드·판이 없다', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: SYSTEM_PRESET_ID });
    putLive({ connected: [true, true] });
    const html = await renderSetup();
    expect(html).toContain('<h2 id="setup-kit-title">내 드럼</h2>');
    expect(html).toContain('프리셋: 시스템 기본 · 8패드');
    expect(html).toContain('setup-kit-zone');
    expect(html).not.toContain('setup-kitinfo');
    expect(html).not.toContain('setup-stage-panel');
    expect(html).not.toContain('ui-card setup-kit');
  });

  it('시스템 기본에서 패드를 옮겼으면 하단 바가 새 프리셋 저장 안내와 [새 프리셋으로 저장]이 된다(kit-drag D10)', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: SYSTEM_PRESET_ID });
    putPresets([preset('p1', '내 배치')]);
    putLive({ connected: [true, true] });
    putSettings({ kitLayout: MOVED_LAYOUT });
    const html = await renderSetup();
    expect(html).toContain('시스템 기본은 바꿀 수 없어요 · 새 프리셋으로 저장해야 남아요');
    expect(html).toMatch(/<button[^>]*>새 프리셋으로 저장</);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>새 프리셋으로 저장</);
  });
  it('시스템 기본에서 옮겼는데 슬롯이 가득 차면 [새 프리셋으로 저장]이 비활성이다(D12)', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: SYSTEM_PRESET_ID });
    putPresets([1, 2, 3, 4, 5].map((n) => preset(`p${n}`, `배치 ${n}`)));
    putLive({ connected: [true, true] });
    putSettings({ kitLayout: MOVED_LAYOUT });
    const html = await renderSetup();
    expect(html).toMatch(/<button[^>]*disabled[^>]*>새 프리셋으로 저장</);
  });
  it('사용자 프리셋이면 [다시 보정]·[새로 보정]이 활성이고 완료 pill', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [{ SNARE: good }, { SNARE: good }], calibratedAt: new Date(2026, 10, 6, 14, 2).getTime(), activePresetId: 'p1' });
    putPresets([preset('p1', '내 배치')]);
    putLive({ connected: [true, true] });
    const html = await renderSetup();
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>다시 보정</);
    expect(html).toMatch(/<button[^>]*>다시 보정</);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>새로 보정</);
    expect(html).toContain('프리셋: 내 배치 · 8패드');
    expect(html).toContain('완료 ');
    expect(html).toContain('「내 배치」 사용 중');
  });

  it('[프리셋 관리]는 칩 줄 오른쪽에, [다시 보정]·[새로 보정]은 머리 줄 오른쪽(setup-stage-actions)에 있다', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [{ SNARE: good }, { SNARE: good }], calibratedAt: new Date(2026, 10, 6, 14, 2).getTime(), activePresetId: 'p1' });
    putPresets([preset('p1', '내 배치')]);
    putLive({ connected: [true, true] });
    const html = await renderSetup();
    const chips = html.slice(html.indexOf('class="setup-chips-right"'), html.indexOf('setup-kit-stage'));
    expect(chips).toContain('프리셋 관리</button>');
    expect(chips).not.toContain('다시 보정');
    // 완료 pill 다음에 [프리셋 관리]
    expect(chips.indexOf('완료 ')).toBeLessThan(chips.indexOf('프리셋 관리'));
    expect(html).toMatch(/class="setup-stage-actions"><button[^>]*>다시 보정<\/button><button[^>]*>새로 보정<\/button>/);
  });

  it('키보드만이어도 [프리셋 관리]는 있다', async () => {
    putSettings({ sensorKind: 'none' });
    const html = await renderSetup();
    expect(html).toContain('프리셋 관리</button>');
    expect(html).not.toContain('setup-stage-action');
  });

  it('키보드만이면 칩 줄 pill이 「키보드만」이고 보정 버튼이 없다', async () => {
    putSettings({ sensorKind: 'none' });
    const html = await renderSetup();
    expect(html).toContain('키보드만');
    expect(html).not.toContain('>새로 보정</button>');
    expect(html).not.toContain('>다시 보정</button>');
  });
});

describe('SetupPage 재배치(내 드럼 무대·타격 확인)', () => {
  it('상태 타일 3개가 .setup-tiles 안에 있다', async () => {
    putSettings({ timingCal: null });
    const html = await renderSetup();
    const start = html.indexOf('class="setup-tiles"');
    const end = html.indexOf('내 드럼</h2>');
    const tiles = html.slice(start, end);
    expect((tiles.match(/class="setup-tile /g) ?? []).length).toBe(3);
    expect(tiles).toContain('id="setup-timing"');
    expect(tiles.indexOf('setup-timing')).toBeGreaterThan(tiles.indexOf('시작 위치 보정'));
  });

  it('평소에는 머리 줄이 한 줄이고 설명 문장(setup-card-desc)이 내 드럼 무대에 없다', async () => {
    const html = await renderSetup();
    expect(html).toContain('class="setup-stage-head"');
    const kit = html.slice(html.indexOf('setup-stage-head'), html.indexOf('setup-adv'));
    expect(kit).not.toContain('setup-card-desc');
    expect(kit).not.toContain('프리셋을 골라 고쳐요');
  });

  it('타격 확인은 무대 컨테이너 안 그림 다음에 하나만 있고(넓으면 CSS가 왼쪽 아래에 띄운다) 손 열이 없다', async () => {
    const html = await renderSetup();
    expect(html.match(/class="setup-hit[ "]/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('is-float');
    expect(html.indexOf('class="setup-hit"')).toBeGreaterThan(html.indexOf('setup-kit-zone'));
    expect(html.indexOf('class="setup-hit"')).toBeLessThan(html.indexOf('setup-kit-guide'));
    expect(html).not.toContain('>손<');
  });

  it('안내 한 줄이 그림 아래에 있다', async () => {
    putSettings({ sensorKind: 'none' });
    const html = await renderSetup();
    expect(html).toContain('아무 패드나 쳐 보세요. 맞게 잡히면 그 자리에 불이 들어와요.');
  });

  it('스틱 연결 끊김 알림은 타격 확인 카드 안에 있고 제목과 안내 두 줄이다', async () => {
    putSettings({ sensorKind: 'pointer' });
    putLive({ connected: [false, false] });
    const html = await renderSetup();
    expect(html.indexOf('스틱 연결 끊김')).toBeGreaterThan(html.indexOf('class="setup-hit"'));
    expect(html).toContain('<strong>스틱 연결 끊김</strong><span>연결 상태를 확인해주세요.</span>');
  });
});

describe('SetupPage 보정 중(UX-64)', () => {
  it('새로 보정 중이면 보정 팝업이 열리고(라벨·[그만하기]·큰 안내), 하단 바는 보정 문구만(저장 버튼 없음, D13)', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: SYSTEM_PRESET_ID });
    putLive({
      connected: [true, true],
      calibration: {
        mode: 'capture',
        target: 'new',
        capture: {
          phase: 'capturing',
          hands: [0, 1],
          order: [...CAPTURE_ORDER],
          index: 0,
          target: 'SNARE',
          targetHands: [0, 1],
          wrongHand: null,
          counts: [0, 0],
          captured: {},
          warning: null,
          lastAccepted: null,
          radiusOverrides: {},
        },
        realign: null,
        hands: [0, 1],
      },
    });
    const html = await renderSetup();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('새 프리셋 보정 · 드럼 위치');
    expect(html).toContain('>그만하기</button>');
    expect(html).toContain('cal-stage-capture');
    expect(html).toContain('<em class="cal-stage-pad">스네어</em>를 양손으로 2번씩 타격하세요');
    expect(html).not.toContain('새 프리셋 · 보정 중');
    expect(html).not.toContain('보정 취소');
    expect(html).toContain('새 프리셋 보정 중 · 7개 중 1번째');
    // D13: 보정 중에는 하단 바에 [저장]·[새 프리셋으로 저장] 버튼이 없다(결과 카드의 [저장]만 남는다)
    expect(html).not.toMatch(/<button[^>]*>저장</);
    expect(html).not.toMatch(/<button[^>]*>새 프리셋으로 저장</);
    expect(html).toContain('setup-bar');
    expect(html).not.toContain('setup-editor');
    // 보정 중 안내 문장은 팝업이 맡는다(페이지에는 없다)
    expect(html).not.toContain('불이 들어온 패드를 2번 쳐요');
    expect(html).toContain('class="setup-hit"');
  });
});

describe('SetupPage 박자 맞추기 타일', () => {
  it('맞춘 적이 없으면 "안 맞춤"과 [맞추기]', async () => {
    putSettings({ timingCal: null, audioOffsetMs: 0 });
    const html = await renderSetup();
    expect(html).not.toContain('timing-cal-row');
    expect(html).toMatch(/<button[^>]*id="setup-timing"[^>]*class="setup-tile is-off is-todo"/);
    expect(html).toContain('안 맞춤');
    expect(html).toContain('<span class="setup-tile-action" aria-hidden="true">맞추기</span>');
  });

  it('맞춘 뒤에는 지금 보정값과 [다시 맞추기]', async () => {
    putSettings({
      timingCal: { measuredAt: 1, medianMs: -66, madMs: 8, pairs: 12, input: 'sensor', outputLatencyMs: null, kick: null },
      audioOffsetMs: -65,
    });
    const html = await renderSetup();
    expect(html).toContain('맞춤 · -65ms');
    expect(html).toContain('>다시 맞추기</span>');
    expect(html).toMatch(/<button[^>]*id="setup-timing"[^>]*class="setup-tile is-on"/);
  });

  it('킥 값이 따로 있으면 스틱·킥 값을 같이 보인다', async () => {
    putSettings({
      timingCal: { measuredAt: 1, medianMs: -66, madMs: 8, pairs: 12, input: 'sensor', outputLatencyMs: null, kick: null },
      audioOffsetMs: -65,
      kickOffsetMs: -40,
    });
    const html = await renderSetup();
    expect(html).toContain('맞춤 · 스틱 -65ms · 킥 -40ms');
    putSettings({ kickOffsetMs: null });
  });

  it('패드 보정 중에는 버튼이 비활성이고 이유를 보인다', async () => {
    putSettings({ sensorKind: 'serial', timingCal: null });
    putLive({
      connected: [true, true],
      calibration: { ...useLive.getState().calibration, mode: 'capture' },
    });
    const html = await renderSetup();
    expect(html).toContain('보정 중에는 열 수 없어요');
    expect(html).toMatch(/<button[^>]*id="setup-timing"[^>]*disabled/);
  });
});
