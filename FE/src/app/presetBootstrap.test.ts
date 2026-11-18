import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapPresets, resetPresetBootstrapForTest, syncPresetSource } from './presetBootstrap';
import { ServerPresetSource } from '@/api/kit/presets';
import { resetForTest } from '@/api/account/auth';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import { TIGHT_LAYOUT, WIDE_LAYOUT } from '@/test/layoutFixtures';
import { SYSTEM_PRESET_ID, type KitPreset } from '@/domain/kit/preset';
import { resetAuthStoreForTest, useAuth, type AuthStatus } from '@/store/authStore';
import { LocalPresetSource } from '@/store/localPresetSource';
import { usePresets } from '@/store/presetStore';
import { useSettings } from '@/store/settingsStore';

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

/** 서버 프리셋 두 개. 7이 기본, 8은 다른 배치·사운드 */
const SERVER = [
  {
    id: 7,
    name: '서버 기본',
    isDefault: true,
    layout: WIDE_LAYOUT,
    sounds: { soundSetId: 'synth' },
    calibration: null,
    schemaVersion: 1,
    createdAt: '2026-10-23T01:00:00Z',
    updatedAt: '2026-10-23T01:00:00Z',
  },
  {
    id: 8,
    name: '서버 둘째',
    isDefault: false,
    layout: TIGHT_LAYOUT,
    sounds: { soundSetId: 'ssaplash' },
    calibration: null,
    schemaVersion: 1,
    createdAt: '2026-10-22T01:00:00Z',
    updatedAt: '2026-10-22T01:00:00Z',
  },
];

const LOCAL: KitPreset = {
  id: 'local-1',
  name: '로컬 기본',
  isDefault: true,
  layout: TIGHT_LAYOUT,
  soundSetId: 'synth',
  schemaVersion: 1,
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
};

/** 서버 목록 요청만 받는 fetch. 그 밖의 경로는 404 */
function mockServer(body: unknown = SERVER, status = 200) {
  const fn = vi.fn(async (url: string) =>
    url === '/api/presets' ? json(status, body, status >= 400 ? 'application/problem+json' : 'application/json') : json(404, {}),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const setStatus = (status: AuthStatus) => useAuth.setState({ status });
const presets = () => usePresets.getState();
const settings = () => useSettings.getState();

beforeEach(() => {
  resetForTest();
  resetAuthStoreForTest();
  resetPresetBootstrapForTest();
  useSettings.setState({
    presets: [],
    // 목록에 없는 id = "적용 중인 프리셋이 없다"(시스템 기본은 항상 유효해 기본 프리셋으로 덮지 않는다)
    activePresetId: 'stale-none',
    presetAnchors: {},
    kitLayout: DEFAULT_KIT_LAYOUT,
    soundSetId: 'ssaplash',
  });
  usePresets.setState({ source: new LocalPresetSource(), items: [], status: 'idle', error: null });
});
afterEach(() => {
  resetPresetBootstrapForTest();
  vi.unstubAllGlobals();
});

describe('syncPresetSource', () => {
  it('unknown·restoring이면 저장소를 바꾸지 않고 서버도 부르지 않는다', async () => {
    const fetch = mockServer();
    const before = presets().source;

    await syncPresetSource('unknown');
    await syncPresetSource('restoring');

    expect(presets().source).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('authenticated: 서버 저장소로 바꾸고 목록을 읽은 뒤, 적용 중인 프리셋이 없으면 기본 프리셋을 적용한다', async () => {
    const fetch = mockServer();

    await syncPresetSource('authenticated');

    expect(presets().source).toBeInstanceOf(ServerPresetSource);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(presets().items.map((p) => p.id)).toEqual(['7', '8']);
    expect(settings().activePresetId).toBe('7');
    expect(settings().kitLayout).toEqual(WIDE_LAYOUT);
    expect(settings().soundSetId).toBe('synth');
  });

  it('authenticated: 영속된 activePresetId가 로컬 id라 목록에 없으면 기본 프리셋으로 바꾼다', async () => {
    mockServer();
    useSettings.setState({ activePresetId: 'local-1', kitLayout: TIGHT_LAYOUT });

    await syncPresetSource('authenticated');

    expect(settings().activePresetId).toBe('7');
    expect(settings().kitLayout).toEqual(WIDE_LAYOUT);
  });

  it('authenticated: 적용 중이던 서버 프리셋이 목록에 있으면 그대로 둔다(기본으로 덮지 않는다)', async () => {
    mockServer();
    useSettings.setState({ activePresetId: '8', kitLayout: DEFAULT_KIT_LAYOUT, soundSetId: 'ssaplash' });

    await syncPresetSource('authenticated');

    expect(settings().activePresetId).toBe('8');
    expect(settings().kitLayout).toEqual(DEFAULT_KIT_LAYOUT);
    expect(settings().soundSetId).toBe('ssaplash');
  });

  it('authenticated: 기본 프리셋이 없고 적용 중인 것도 목록에 없으면 시스템 기본을 적용한다(UX-64 D1)', async () => {
    mockServer([{ ...SERVER[1], isDefault: false }]);
    useSettings.setState({ activePresetId: 'local-1', kitLayout: TIGHT_LAYOUT });

    await syncPresetSource('authenticated');

    expect(presets().items.map((p) => p.id)).toEqual(['8']);
    expect(settings().activePresetId).toBe(SYSTEM_PRESET_ID);
    expect(settings().kitLayout).toEqual(DEFAULT_KIT_LAYOUT);
  });

  it('authenticated: 시스템 기본이 적용 중이면 기본 프리셋이 있어도 그대로 둔다', async () => {
    mockServer();
    useSettings.setState({ activePresetId: SYSTEM_PRESET_ID });

    await syncPresetSource('authenticated');

    expect(settings().activePresetId).toBe(SYSTEM_PRESET_ID);
    expect(settings().kitLayout).toEqual(DEFAULT_KIT_LAYOUT);
  });

  it('authenticated: 목록 읽기에 실패하면 오류 상태만 남기고 적용 프리셋은 건드리지 않는다', async () => {
    mockServer({ status: 500, code: 'INTERNAL_ERROR', detail: '서버 오류' }, 500);
    useSettings.setState({ activePresetId: 'local-1' });

    await syncPresetSource('authenticated');

    expect(presets().source).toBeInstanceOf(ServerPresetSource);
    expect(presets().status).toBe('error');
    expect(presets().error).toBe('NETWORK');
    expect(settings().activePresetId).toBe('local-1');
  });

  it('anonymous: 로컬 저장소로 바꾸고 settingsStore.presets를 읽어 기본을 적용한다(개발 빌드)', async () => {
    const fetch = mockServer();
    useSettings.setState({ presets: [LOCAL] });

    await syncPresetSource('anonymous');

    expect(presets().source).toBeInstanceOf(LocalPresetSource);
    expect(fetch).not.toHaveBeenCalled();
    expect(presets().items.map((p) => p.id)).toEqual(['local-1']);
    expect(settings().activePresetId).toBe('local-1');
    expect(settings().soundSetId).toBe('synth');
  });

  it('authenticated → anonymous: 서버 목록을 비우고 로컬로 되돌린다(로그아웃·세션 만료)', async () => {
    mockServer();
    await syncPresetSource('authenticated');
    expect(presets().items).toHaveLength(2);

    await syncPresetSource('anonymous');

    expect(presets().source).toBeInstanceOf(LocalPresetSource);
    expect(presets().items).toEqual([]);
    expect(settings().activePresetId).toBe(SYSTEM_PRESET_ID);
  });

  it('같은 상태를 다시 받으면 목록을 다시 읽지 않는다', async () => {
    const fetch = mockServer();

    await syncPresetSource('authenticated');
    await syncPresetSource('authenticated');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('서버 목록을 읽는 중에 anonymous로 바뀌면 끝난 뒤 로컬 목록이 남는다(순서 보장)', async () => {
    let release!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((r) => (release = r)));
    vi.stubGlobal('fetch', fetch);
    useSettings.setState({ presets: [LOCAL] });

    const first = syncPresetSource('authenticated');
    // 서버 요청이 나간 뒤(마이크로태스크) 상태를 바꾸고, 그다음에 서버 응답을 풀어준다
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const second = syncPresetSource('anonymous');
    release(json(200, SERVER));
    await Promise.all([first, second]);

    expect(presets().source).toBeInstanceOf(LocalPresetSource);
    expect(presets().items.map((p) => p.id)).toEqual(['local-1']);
    expect(settings().activePresetId).toBe('local-1');
  });
});

describe('bootstrapPresets', () => {
  it('authStore 상태 변화를 구독해 복원이 끝나면 저장소를 맞춘다', async () => {
    const fetch = mockServer();

    bootstrapPresets();
    expect(fetch).not.toHaveBeenCalled();

    setStatus('restoring');
    setStatus('authenticated');
    await syncPresetSource('authenticated');

    expect(presets().source).toBeInstanceOf(ServerPresetSource);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(settings().activePresetId).toBe('7');
  });

  it('status가 아닌 필드만 바뀌면 반응하지 않는다', async () => {
    const fetch = mockServer();
    bootstrapPresets();
    setStatus('authenticated');
    await syncPresetSource('authenticated');

    useAuth.setState({ lostReason: 'network' });
    await syncPresetSource('authenticated');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('부를 때 이미 anonymous면 바로 로컬 저장소를 맞춘다', async () => {
    mockServer();
    useSettings.setState({ presets: [LOCAL] });
    setStatus('anonymous');

    bootstrapPresets();
    await syncPresetSource('anonymous');

    expect(presets().source).toBeInstanceOf(LocalPresetSource);
    expect(settings().activePresetId).toBe('local-1');
  });
});
