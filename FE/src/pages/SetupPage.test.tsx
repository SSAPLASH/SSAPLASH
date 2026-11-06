import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { usePresets } from '@/store/presetStore';
import { SYSTEM_PRESET_ID, type KitPreset } from '@/domain/preset';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kitLayout';
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
  it('접힘 요약에 판정·낙하·카운트인·메트로놈만 있고 음량·오디오 오프셋은 없다', async () => {
    const html = await renderSetup();
    expect(html).toContain('판정 반경 · 판정 폭 · 노트 낙하 · 카운트인 · 메트로놈');
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
  // 인수 조건: 동글 소스면 ① 카드에 페달 줄이 보인다(포트가 닫혀 있으면 재탐색 안내 없이 "페달 연결 안 됨")
  it('동글 소스에서는 "페달 연결 안 됨" 줄이 보인다', async () => {
    putSettings({ sensorKind: 'webserial' });
    const html = await renderSetup();
    expect(html).toContain('setup-pedal');
    expect(html).toContain('페달 연결 안 됨');
    expect(html).not.toContain('동글을 다시 꽂아 주세요');
  });

  // 인수 조건: 포인터 소스에서는 페달 줄이 없다
  it('포인터 소스에서는 페달 줄이 없다', async () => {
    putSettings({ sensorKind: 'pointer' });
    const html = await renderSetup();
    expect(html).not.toContain('setup-pedal');
  });

  // 인수 조건: 키보드 전용(기본)에서도 페달 줄이 없다
  it('키보드 전용에서는 페달 줄이 없다', async () => {
    expect(await renderSetup()).not.toContain('setup-pedal');
  });
});

describe('SetupPage 단계 2개(UX-64)', () => {
  it('상단은 스틱 연결·시작 위치 보정 두 단계이고 ③ 프리셋 카드가 없다', async () => {
    putSettings({ sensorKind: 'pointer' });
    putLive({ connected: [true, true] });
    const html = await renderSetup();
    expect(html).toContain('2단계 중');
    expect(html).toContain('시작 위치 보정');
    expect(html).not.toContain('step-preset');
    expect(html).not.toContain('새 프리셋으로 저장</button>'.replace('</button>', '')); // 하단 바에도 없다(시스템 기본은 저장 대상이 아님)
    expect(html).not.toContain('적용된 프리셋 없음');
  });
});

describe('SetupPage ② 시작 위치 보정(UX-64 D7)', () => {
  it('시스템 기본이면 앵커가 없어도 완료 요약(카드는 접힘)', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: SYSTEM_PRESET_ID });
    putLive({ connected: [true, true], referenceSetAt: null });
    const html = await renderSetup();
    expect(html).toContain('시스템 기본 배치 · 보정 없이 바로 칠 수 있어요');
    expect(html).not.toContain('보정 시작');
  });

  it('사용자 프리셋인데 앵커가 없으면 "드럼 위치를 아직 잡지 않았어요", 펼친 본문에 [시작 위치 잡기]와 드럼 배치 안내', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: 'p1' });
    putPresets([preset('p1', '내 배치')]);
    putLive({ connected: [true, true] });
    const html = await renderSetup();
    expect(html).toContain('드럼 위치를 아직 잡지 않았어요');
    expect(html).toContain('>시작 위치 잡기</button>');
    expect(html).toContain('[전체 보정] 또는 [추가하기]');
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

describe('SetupPage 드럼 배치 카드 칩 줄(UX-64)', () => {
  it('시스템 기본 칩 + 저장 프리셋 칩 + [추가하기] + [전체 보정]. 시스템 기본이면 전체 보정·이 드럼 다시 치기·기본 배치로가 비활성이고 안내가 보인다', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [null, null], activePresetId: SYSTEM_PRESET_ID });
    putPresets([preset('p1', '내 배치'), preset('p2', '재즈 연습')]);
    putLive({ connected: [true, true] });
    const html = await renderSetup();
    expect(html).toContain('시스템 기본 · 고정');
    expect(html).toContain('>내 배치</button>');
    expect(html).toContain('>재즈 연습</button>');
    expect(html).toContain('추가하기');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>전체 보정</);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>이 드럼 다시 치기</);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>기본 배치로</);
    expect(html).toContain('고정 배치예요');
    expect(html).toContain('「시스템 기본」 사용 중');
  });

  it('사용자 프리셋이면 [전체 보정]·[이 드럼 다시 치기]가 활성이고 완료 pill', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [{ SNARE: good }, { SNARE: good }], calibratedAt: new Date(2026, 10, 6, 14, 2).getTime(), activePresetId: 'p1' });
    putPresets([preset('p1', '내 배치')]);
    putLive({ connected: [true, true] });
    const html = await renderSetup();
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>전체 보정</);
    expect(html).toContain('>이 드럼 다시 치기</button>');
    expect(html).toContain('완료 ');
    expect(html).toContain('「내 배치」 사용 중');
  });

  it('키보드만이면 칩 줄 pill이 「키보드만」이고 보정 버튼이 없다', async () => {
    putSettings({ sensorKind: 'none' });
    const html = await renderSetup();
    expect(html).toContain('키보드만');
    expect(html).not.toContain(' 추가하기</button>');
    expect(html).not.toContain('>전체 보정</button>');
    expect(html).not.toContain('>이 드럼 다시 치기</button>');
  });
});

describe('SetupPage 보정 중(UX-64)', () => {
  it('추가하기 보정 중이면 드럼 배치 카드가 보정 무대이고 칩 줄은 「새 프리셋 · 보정 중」 + pill + [보정 취소], 하단 바는 보정 문구에 [저장] 비활성', async () => {
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
    expect(html).toContain('cal-stage-capture');
    expect(html).toContain('스네어를 2번 타격하세요');
    expect(html).toContain('새 프리셋 · 보정 중');
    expect(html).toContain('보정 중 1 / 7');
    expect(html).toContain('보정 취소');
    expect(html).toContain('새 프리셋 보정 중 · 7개 중 1번째');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>저장</);
    expect(html).not.toContain('setup-editor');
  });
});
