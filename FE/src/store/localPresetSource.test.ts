import { beforeEach, describe, expect, it } from 'vitest';
import { LocalPresetSource } from './localPresetSource';
import { useSettings } from './settingsStore';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import { WIDE_LAYOUT } from '@/test/layoutFixtures';
import { MAX_PRESETS, type PresetDraft } from '@/domain/kit/preset';

const src = new LocalPresetSource();
const draft = (name: string, over: Partial<PresetDraft> = {}): PresetDraft => ({
  name,
  layout: DEFAULT_KIT_LAYOUT,
  soundSetId: 'ssaplash',
  ...over,
});

/** 생성 시각이 겹치지 않게 약간 기다린다(최근 생성 정렬 검증용) */
const tick = () => new Promise((r) => setTimeout(r, 3));

beforeEach(() => useSettings.setState({ presets: [] }));

describe('LocalPresetSource', () => {
  it('create: 메타를 채우고 첫 프리셋만 기본', async () => {
    const a = await src.create(draft('  첫째 ', { soundSetId: 'synth' }));
    expect(a).toMatchObject({ name: '첫째', isDefault: true, schemaVersion: 1, soundSetId: 'synth' });
    expect(a.id.startsWith('local-')).toBe(true);
    expect(a.updatedAt).toBe(a.createdAt);
    const b = await src.create(draft('둘째'));
    expect(b.isDefault).toBe(false);
    expect(b.id).not.toBe(a.id);
  });

  it('create: 중복 이름은 NAME_DUPLICATE, 11번째는 LIMIT_EXCEEDED', async () => {
    await src.create(draft('x'));
    await expect(src.create(draft('x'))).rejects.toMatchObject({ code: 'NAME_DUPLICATE' });
    for (let i = 1; i < MAX_PRESETS; i += 1) await src.create(draft(`p${i}`));
    await expect(src.create(draft('넘침'))).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('list: 기본이 첫째, 나머지는 최근 생성 순', async () => {
    const a = await src.create(draft('a'));
    await tick();
    const b = await src.create(draft('b'));
    await tick();
    const c = await src.create(draft('c'));
    expect((await src.list()).map((p) => p.id)).toEqual([a.id, c.id, b.id]);
  });

  it('update: 내용·updatedAt 갱신, isDefault 유지, 자기 이름은 중복 아님', async () => {
    const a = await src.create(draft('a'));
    await tick();
    const next = await src.update(a.id, draft('a', { layout: WIDE_LAYOUT, soundSetId: 'synth' }));
    expect(next.layout).toEqual(WIDE_LAYOUT);
    expect(next.isDefault).toBe(true);
    expect(next.createdAt).toBe(a.createdAt);
    expect(next.updatedAt > a.updatedAt).toBe(true);
  });

  it('update: 없는 id는 NOT_FOUND, 다른 프리셋 이름과 겹치면 NAME_DUPLICATE', async () => {
    const a = await src.create(draft('a'));
    await src.create(draft('b'));
    await expect(src.update('none', draft('z'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(src.update(a.id, draft('b'))).rejects.toMatchObject({ code: 'NAME_DUPLICATE' });
  });

  it('remove: 기본을 지우면 남은 것 중 가장 최근 생성이 기본', async () => {
    const a = await src.create(draft('a'));
    await tick();
    await src.create(draft('b'));
    await tick();
    const c = await src.create(draft('c'));
    await src.remove(a.id);
    const list = await src.list();
    expect(list.map((p) => p.id)[0]).toBe(c.id);
    expect(list.filter((p) => p.isDefault)).toHaveLength(1);
  });

  it('remove: 기본이 아닌 걸 지우면 기본 유지, 없는 id는 NOT_FOUND', async () => {
    const a = await src.create(draft('a'));
    const b = await src.create(draft('b'));
    await src.remove(b.id);
    expect((await src.list())[0].id).toBe(a.id);
    await expect(src.remove(b.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('setDefault: 이전 기본을 해제한다', async () => {
    const a = await src.create(draft('a'));
    const b = await src.create(draft('b'));
    const got = await src.setDefault(b.id);
    expect(got.isDefault).toBe(true);
    const list = await src.list();
    expect(list.find((p) => p.id === a.id)!.isDefault).toBe(false);
    expect(list.filter((p) => p.isDefault)).toHaveLength(1);
    await expect(src.setDefault('none')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
