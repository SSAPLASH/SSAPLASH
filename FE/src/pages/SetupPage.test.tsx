import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
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
function putSettings(patch: Record<string, unknown>): void {
  const initial = useSettings.getInitialState() as unknown as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    const prev = initial[key];
    restores.push(() => {
      initial[key] = prev;
    });
  }
  Object.assign(initial, patch);
  useSettings.setState(patch);
}
afterEach(() => {
  while (restores.length) restores.pop()?.();
});

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

describe('SetupPage ② 드럼 위치 보정(PLAY-004 4-5)', () => {
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
  const good = { pad: 'SNARE' as const, pitch: -20, yaw: 3, radius: 18, samples: 2, spread: 1 };

  it('앵커가 없으면 "드럼 위치를 아직 잡지 않았어요"와 [보정 시작]. 드래그 칩은 없다', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [null, null] });
    putLive({ connected: [true, true] });
    const html = await renderSetup();
    expect(html).toContain('드럼 위치를 아직 잡지 않았어요');
    expect(html).toContain('보정 시작');
    expect(html).not.toContain('넓게');
    expect(html).not.toContain('좁게');
    expect(html).not.toContain('패드를 끌어');
  });

  it('양손 앵커가 있으면 완료 요약과 [다시 하기]', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [{ SNARE: good }, { SNARE: good }] });
    putLive({ connected: [true, true], referenceSetAt: null });
    const html = await renderSetup();
    expect(html).toContain('보정했어요');
    expect(html).toContain('다시 하기');
  });

  it('한 손만 보정한 채 다른 손이 붙으면 다시 "보정 필요"', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [{ SNARE: good }, null] });
    putLive({ connected: [true, true] });
    expect(await renderSetup()).toContain('드럼 위치를 아직 잡지 않았어요');
  });

  it('재정렬이 필요한 손이 있으면 요약이 그 손을 짚는다', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [{ SNARE: good }, { SNARE: good }] });
    putLive({ connected: [true, true], realignNeeded: [false, true] });
    expect(await renderSetup()).toContain('오른손 스틱이 다시 켜졌어요 · 스네어를 한 번 쳐 주세요');
  });

  it('보정 중이면 ② 본문이 CalibrationStage', async () => {
    putSettings({ sensorKind: 'pointer', stickAnchors: [null, null] });
    putLive({
      connected: [true, true],
      calibration: {
        mode: 'capture',
        capture: { phase: 'capturing', hands: [0, 1], index: 0, target: 'SNARE', counts: [0, 0], captured: {}, warning: null, lastAccepted: null },
        realign: null,
        hands: [0, 1],
      },
    });
    const html = await renderSetup();
    expect(html).toContain('cal-stage-capture');
    expect(html).toContain('스네어를 양손으로 2번씩 쳐 주세요');
  });
});
