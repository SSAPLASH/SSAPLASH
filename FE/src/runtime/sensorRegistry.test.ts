import { describe, expect, it, vi } from 'vitest';
import { BaseInputSource } from '@/input/source/InputSource';
import type { SourceDescriptor } from '@/input/source/SourceDescriptor';
import { SensorRegistry, resolveOptions } from './sensorRegistry';

class FakeSource extends BaseInputSource {
  readonly kind: string;
  readonly label = '가짜 소스';
  constructor(kind: string) {
    super();
    this.kind = kind;
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

const makeDesc = (id: string, extra: Partial<SourceDescriptor> = {}): SourceDescriptor => ({
  id,
  label: `소스 ${id}`,
  description: '테스트용',
  availability: () => ({ ok: true }),
  create: () => new FakeSource(id),
  ...extra,
});

describe('SensorRegistry', () => {
  it('등록 순서대로 list에 나온다', () => {
    const r = new SensorRegistry();
    r.register(makeDesc('b'));
    r.register(makeDesc('a'));
    r.register(makeDesc('c'));
    expect(r.list().map((d) => d.id)).toEqual(['b', 'a', 'c']);
    expect(r.get('a')?.label).toBe('소스 a');
    expect(r.get('zzz')).toBeUndefined();
  });

  it('같은 id를 두 번 등록하면 예외', () => {
    const r = new SensorRegistry();
    r.register(makeDesc('x'));
    expect(() => r.register(makeDesc('x'))).toThrow();
    expect(r.list()).toHaveLength(1);
  });

  it("'none'·'keyboard' id는 거부한다", () => {
    const r = new SensorRegistry();
    expect(() => r.register(makeDesc('none'))).toThrow();
    expect(() => r.register(makeDesc('keyboard'))).toThrow();
    expect(r.list()).toHaveLength(0);
  });

  it("isKnown: 'none'은 항상 true, 등록 전 id는 false", () => {
    const r = new SensorRegistry();
    expect(r.isKnown('none')).toBe(true);
    expect(r.isKnown('x')).toBe(false);
    r.register(makeDesc('x'));
    expect(r.isKnown('x')).toBe(true);
    expect(r.isKnown('keyboard')).toBe(false);
  });

  it('instance는 첫 호출에만 create하고 이후 캐시를 돌려준다', () => {
    const r = new SensorRegistry();
    const create = vi.fn(() => new FakeSource('x'));
    r.register(makeDesc('x', { create }));
    expect(create).not.toHaveBeenCalled(); // 지연 생성
    const a = r.instance('x');
    const b = r.instance('x');
    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('모르는 id의 instance는 예외 (none 포함)', () => {
    const r = new SensorRegistry();
    expect(() => r.instance('nope')).toThrow();
    expect(() => r.instance('none')).toThrow();
  });

  it('options·actions·reservedKeys가 있는 가짜 디스크립터가 list에 나타난다', () => {
    const r = new SensorRegistry();
    const run = vi.fn(async () => {});
    const applyOptions = vi.fn();
    r.register(
      makeDesc('fake', {
        options: [{ key: 'baud', label: '보레이트', type: 'number', default: 115200, min: 9600, max: 921600 }],
        actions: [{ label: '포트 선택', run }],
        reservedKeys: (o) => [`Key${String(o.baud)}`],
        applyOptions,
      }),
    );
    const d = r.list().find((x) => x.id === 'fake')!;
    expect(d.options).toHaveLength(1);
    expect(d.actions?.[0].label).toBe('포트 선택');
    expect(d.reservedKeys?.({ baud: 1 })).toEqual(['Key1']);
    // 레지스트리 밖(bootstrap)이 하는 호출 흐름
    const inst = r.instance('fake');
    d.applyOptions?.(inst, resolveOptions(d, undefined));
    expect(applyOptions).toHaveBeenCalledWith(inst, { baud: 115200 });
    void d.actions?.[0].run(inst);
    expect(run).toHaveBeenCalledWith(inst);
  });
});

describe('resolveOptions', () => {
  const d = makeDesc('x', {
    options: [
      { key: 'a', label: 'A', type: 'text', default: '기본' },
      { key: 'b', label: 'B', type: 'boolean', default: false },
    ],
  });

  it('저장값이 없으면 기본값', () => {
    expect(resolveOptions(d, undefined)).toEqual({ a: '기본', b: false });
  });

  it('저장값이 기본값을 덮어쓰고 일부만 있어도 나머지는 기본값', () => {
    expect(resolveOptions(d, { b: true })).toEqual({ a: '기본', b: true });
  });
});
