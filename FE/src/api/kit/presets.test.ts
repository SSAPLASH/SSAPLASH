import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerPresetSource, toKitPreset, toPresetError } from './presets';
import { resetForTest } from '@/api/account/auth';
import { ApiError } from '@/api/http';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import { PRESET_SCHEMA_VERSION, PresetError, type PresetDraft } from '@/domain/kit/preset';

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

/** fetch를 핸들러로 대체한다. 호출 기록은 돌려주는 mock으로 본다 */
function mockFetch(handler: Handler) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

const problem = (status: number, code: string, detail: string) =>
  json(status, { status, code, detail }, 'application/problem+json');

/** BE 응답 예(README "키트 프리셋"). calibration은 V11 BE가 null로 내려주는 값 — FE는 읽지 않는다 */
const DTO = {
  id: 7,
  name: '연습용',
  isDefault: true,
  layout: DEFAULT_KIT_LAYOUT,
  sounds: { soundSetId: 'synth' },
  calibration: null,
  schemaVersion: 1,
  createdAt: '2026-10-23T01:00:00Z',
  updatedAt: '2026-10-23T02:00:00Z',
};

const EXPECTED = {
  id: '7',
  name: '연습용',
  isDefault: true,
  layout: DEFAULT_KIT_LAYOUT,
  soundSetId: 'synth',
  schemaVersion: 1,
  createdAt: '2026-10-23T01:00:00Z',
  updatedAt: '2026-10-23T02:00:00Z',
};

const draft: PresetDraft = { name: '내 킷', layout: DEFAULT_KIT_LAYOUT, soundSetId: 'ssaplash' };

const bodyOf = (init: RequestInit | undefined) => JSON.parse(init?.body as string) as Record<string, unknown>;

beforeEach(() => resetForTest());
afterEach(() => vi.unstubAllGlobals());

describe('toKitPreset', () => {
  it('id는 문자열, sounds.soundSetId는 soundSetId로 올리고 calibration은 버린다', () => {
    const preset = toKitPreset(DTO);
    expect(preset).toEqual(EXPECTED);
    expect(preset).not.toHaveProperty('calibration');
  });

  it('옛 이름 HI_TOM·빠진 패드는 SMALL_TOM으로 옮기고 기본 배치로 채운다', () => {
    const { SMALL_TOM: _s, MID_TOM: _m, HIHAT_PEDAL: _h, ...rest } = DEFAULT_KIT_LAYOUT;
    void _s;
    void _m;
    void _h;
    const hi = { x: 0.1, y: 0.2, r: 0.3 };
    const layout = toKitPreset({ ...DTO, layout: { ...rest, HI_TOM: hi } }).layout;
    expect(layout.SMALL_TOM).toEqual(hi);
    expect(layout.MID_TOM).toEqual(DEFAULT_KIT_LAYOUT.MID_TOM);
    expect(layout.HIHAT_PEDAL).toEqual(DEFAULT_KIT_LAYOUT.HIHAT_PEDAL);
    expect(layout).not.toHaveProperty('HI_TOM');
  });

  it('모르는 soundSetId는 ssaplash로 보정한다', () => {
    expect(toKitPreset({ ...DTO, sounds: { soundSetId: 'removed-set' } }).soundSetId).toBe('ssaplash');
    expect(toKitPreset({ ...DTO, sounds: {} }).soundSetId).toBe('ssaplash');
  });
});

describe('ServerPresetSource', () => {
  const src = new ServerPresetSource();

  it('list: GET /api/presets 응답을 순서 그대로 KitPreset으로 바꾼다', async () => {
    const fetch = mockFetch(() => json(200, [DTO, { ...DTO, id: 8, name: '둘째', isDefault: false }]));

    const items = await src.list();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/presets');
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(items).toEqual([EXPECTED, { ...EXPECTED, id: '8', name: '둘째', isDefault: false }]);
  });

  it('create: POST 본문은 name·layout·sounds·schemaVersion뿐이고 calibration을 보내지 않는다', async () => {
    const fetch = mockFetch(() =>
      json(201, { ...DTO, id: 8, name: '내 킷', isDefault: false, sounds: { soundSetId: 'ssaplash' } }),
    );

    const created = await src.create(draft);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/presets');
    expect(init?.method).toBe('POST');
    const body = bodyOf(init);
    expect(body).toEqual({
      name: '내 킷',
      layout: DEFAULT_KIT_LAYOUT,
      sounds: { soundSetId: 'ssaplash' },
      schemaVersion: PRESET_SCHEMA_VERSION,
    });
    expect(body).not.toHaveProperty('calibration');
    expect(created).toEqual({ ...EXPECTED, id: '8', name: '내 킷', isDefault: false, soundSetId: 'ssaplash' });
  });

  it('update: PUT /api/presets/{id}에 같은 본문을 보낸다', async () => {
    const fetch = mockFetch(() => json(200, { ...DTO, name: '내 킷', sounds: { soundSetId: 'ssaplash' } }));

    const updated = await src.update('7', draft);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/presets/7');
    expect(init?.method).toBe('PUT');
    expect(bodyOf(init)).toEqual({
      name: '내 킷',
      layout: DEFAULT_KIT_LAYOUT,
      sounds: { soundSetId: 'ssaplash' },
      schemaVersion: PRESET_SCHEMA_VERSION,
    });
    expect(updated).toEqual({ ...EXPECTED, name: '내 킷', soundSetId: 'ssaplash' });
  });

  it('remove: DELETE /api/presets/{id}, 204면 값 없이 끝난다', async () => {
    const fetch = mockFetch(() => new Response(null, { status: 204 }));

    await expect(src.remove('7')).resolves.toBeUndefined();

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/presets/7');
    expect(init?.method).toBe('DELETE');
    expect(init?.body).toBeUndefined();
  });

  it('setDefault: PUT /api/presets/{id}/default, 본문 없이 보내고 응답을 바꾼다', async () => {
    const fetch = mockFetch(() => json(200, DTO));

    const preset = await src.setDefault('7');

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/presets/7/default');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBeUndefined();
    expect(preset).toEqual(EXPECTED);
  });

  describe('오류 매핑', () => {
    it.each([
      ['PRESET_NAME_DUPLICATE', 409, 'NAME_DUPLICATE'],
      ['PRESET_LIMIT_EXCEEDED', 409, 'LIMIT_EXCEEDED'],
      ['PRESET_NOT_FOUND', 404, 'NOT_FOUND'],
      ['PRESET_CONFLICT', 409, 'CONFLICT'],
      ['VALIDATION_FAILED', 400, 'NETWORK'],
      ['INTERNAL_ERROR', 500, 'NETWORK'],
    ])('%s(%i) → PresetError %s, 메시지는 BE detail', async (code, status, expected) => {
      mockFetch(() => problem(status, code, '서버가 보낸 문장'));

      const err = await src.create(draft).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(PresetError);
      expect((err as PresetError).code).toBe(expected);
      expect((err as PresetError).message).toBe('서버가 보낸 문장');
    });

    it('fetch 자체가 실패하면(네트워크) NETWORK', async () => {
      mockFetch(() => {
        throw new TypeError('Failed to fetch');
      });

      const err = await src.list().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(PresetError);
      expect((err as PresetError).code).toBe('NETWORK');
    });

    it('problem+json이 아닌 5xx(프록시 오류 페이지)도 NETWORK', async () => {
      mockFetch(() => new Response('<html>bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));

      const err = await src.remove('7').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(PresetError);
      expect((err as PresetError).code).toBe('NETWORK');
    });

    it('toPresetError: PresetError는 그대로, ApiError는 코드 표로, 그 밖의 예외는 NETWORK', () => {
      const own = new PresetError('LIMIT_EXCEEDED');
      expect(toPresetError(own)).toBe(own);
      expect(toPresetError(new ApiError(404, 'PRESET_NOT_FOUND', '없음')).code).toBe('NOT_FOUND');
      expect(toPresetError(new ApiError(0, 'NETWORK', '연결 실패')).code).toBe('NETWORK');
      expect(toPresetError(new Error('boom')).code).toBe('NETWORK');
      expect(toPresetError('문자열').code).toBe('NETWORK');
    });
  });
});
