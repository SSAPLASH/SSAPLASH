import { describe, expect, it, vi } from 'vitest';
import type { FxSheetId } from '@/domain/hitFx/types';
import { createFxSheetStore } from './fxSheets';

const IDS: FxSheetId[] = ['water-side-a', 'water-front'];
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const fakeImage = (src: string) => ({ src }) as unknown as CanvasImageSource;

function make() {
  const load = vi.fn((src: string) => Promise.resolve(fakeImage(src)));
  return { load, store: createFxSheetStore({ load, enabled: true }) };
}

describe('fxSheets 보관소', () => {
  it('빈 목록은 ready, 불러오기 전에는 not ready, 디코드되면 ready·get', async () => {
    const { store } = make();
    const a = {};
    expect(store.ready([])).toBe(true);
    store.use(a, IDS);
    expect(store.ready(IDS)).toBe(false);
    expect(store.get('water-front')).toBeNull();
    await flush();
    expect(store.ready(IDS)).toBe(true);
    expect((store.get('water-front') as unknown as { src: string }).src).toBe('/fx/water-front.v1.webp');
  });

  it('같은 묶음을 여러 번·여러 소유자가 요청해도 한 번만 받는다', async () => {
    const { store, load } = make();
    const a = {};
    const b = {};
    store.use(a, IDS);
    store.use(a, IDS);
    store.use(b, IDS);
    await flush();
    store.use(b, IDS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('소유자 둘 중 하나가 놓아도 다른 쪽이 쓰면 유지된다', async () => {
    const { store } = make();
    const a = {};
    const b = {};
    store.use(a, IDS);
    store.use(b, ['water-front']);
    await flush();
    store.use(a, []);
    expect(store.get('water-front')).not.toBeNull();
    expect(store.get('water-side-a')).toBeNull();
  });

  it('아무도 쓰지 않으면 버리고, 다시 쓰면 새로 받는다', async () => {
    const { store, load } = make();
    const a = {};
    store.use(a, IDS);
    await flush();
    store.use(a, []);
    expect(store.ready(IDS)).toBe(false);
    expect(store.get('water-front')).toBeNull();
    store.use(a, IDS);
    await flush();
    expect(load).toHaveBeenCalledTimes(4);
    expect(store.ready(IDS)).toBe(true);
  });

  it('목록을 통째로 바꾸면 빠진 묶음은 버린다', async () => {
    const { store } = make();
    const a = {};
    store.use(a, ['water-side-a']);
    await flush();
    store.use(a, ['fire-front']);
    expect(store.get('water-side-a')).toBeNull();
    await flush();
    expect(store.get('fire-front')).not.toBeNull();
  });

  it('받는 도중 버려지면 늦게 끝난 결과를 보관하지 않는다', async () => {
    let resolve: (v: CanvasImageSource) => void = () => {};
    const load = vi.fn(() => new Promise<CanvasImageSource>((r) => (resolve = r)));
    const store = createFxSheetStore({ load, enabled: true });
    const a = {};
    store.use(a, ['water-front']);
    store.use(a, []);
    resolve(fakeImage('x'));
    await flush();
    expect(store.get('water-front')).toBeNull();
  });

  it('실패하면 없음으로 두고 다음 use에서 다시 시도한다', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('404')).mockImplementation((src: string) => Promise.resolve(fakeImage(src)));
    const store = createFxSheetStore({ load, enabled: true });
    const a = {};
    store.use(a, ['water-front']);
    await flush();
    expect(store.ready(['water-front'])).toBe(false);
    store.use(a, ['water-front']);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.ready(['water-front'])).toBe(true);
  });

  it('enabled가 false면 아무것도 불러오지 않는다(항상 not ready)', async () => {
    const load = vi.fn(() => Promise.resolve(fakeImage('x')));
    const store = createFxSheetStore({ load, enabled: false });
    store.use({}, IDS);
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(store.ready(IDS)).toBe(false);
  });
});
