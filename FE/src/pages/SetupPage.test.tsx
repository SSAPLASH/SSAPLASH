import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettings } from '@/store/settingsStore';
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
