// stickStageDraw: 가짜 2D 컨텍스트로 예외 없이 그려지는지, 단계별 층(블루투스 표시·센서 축)과 글자 크기 하한을 확인한다.
import { describe, expect, it } from 'vitest';
import { stickLayers } from '@/features/landing/domain/landingMotion';
import { buildLayoutA, layoutBounds, type StageStep } from '@/features/landing/domain/stickLayout';
import { fitCamera } from '@/features/landing/domain/stickSpace';
import { BEAT, hitsBetween, poseAt } from '@/features/landing/domain/stickStroke';
import { DEFAULT_BRAND, bleChipName, drawStage, parseCssColor, type StageFrame } from './stickStageDraw';

interface FakeCtx {
  ctx: CanvasRenderingContext2D;
  texts: Array<{ text: string; font: string }>;
  calls: Record<string, number>;
}

// 호출을 기록하고 속성 대입은 그대로 저장하는 가짜 2D 컨텍스트
function fakeContext(): FakeCtx {
  const store: Record<string, unknown> = {};
  const texts: FakeCtx['texts'] = [];
  const calls: Record<string, number> = {};
  const ctx = new Proxy(store, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls[prop] = (calls[prop] ?? 0) + 1;
        if (prop === 'fillText') texts.push({ text: String(args[0]), font: String(target.font) });
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return { addColorStop() {} };
        return undefined;
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, calls };
}

function frameAt(step: StageStep, t: number, width = 520, layers = stickLayers(step)): StageFrame {
  const base = buildLayoutA();
  const layout = { ...base, camera: fitCamera(base.camera, layoutBounds(base), width, width) };
  return {
    layout,
    width,
    height: width,
    dpr: 2,
    t,
    step,
    poses: layout.sticks.map((_, i) => poseAt(layout, i, t, step)),
    hits: hitsBetween(layout, t - 1, t, step),
    layers,
    brand: DEFAULT_BRAND,
    font: 'sans-serif',
  };
}

describe('drawStage', () => {
  it('단계 0·1·2의 여러 시각에서 예외 없이 그린다', () => {
    for (const step of [0, 1, 2] as StageStep[]) {
      for (const t of [0, 0.03, 0.5, 1.7, 4.2, 9.9]) {
        const { ctx, calls } = fakeContext();
        expect(() => drawStage(ctx, frameAt(step, t))).not.toThrow();
        expect(calls.clearRect).toBe(1);
        expect(calls.fill).toBeGreaterThan(50); // 띠·패드·팁 등
      }
    }
  });

  it('폭 360(띠 12)과 폭 520(띠 18)의 그리기 호출 수가 다르다', () => {
    const wide = fakeContext();
    const narrow = fakeContext();
    drawStage(wide.ctx, frameAt(1, 0.5, 520));
    drawStage(narrow.ctx, frameAt(1, 0.5, 360));
    expect(wide.calls.fill).toBeGreaterThan(narrow.calls.fill);
  });

  it('블루투스 표시의 이름은 단계 2에서만 그려진다', () => {
    const count = (step: StageStep) => {
      const { ctx, texts } = fakeContext();
      drawStage(ctx, frameAt(step, 0.03));
      return texts.filter((x) => x.text === 'SNARE').length;
    };
    expect(count(0)).toBe(0); // 단계 0은 패드 이름도 블루투스 표시도 없다
    expect(count(1)).toBe(1); // 패드 이름만
    expect(count(2)).toBe(2); // 패드 이름 + 블루투스 표시
  });

  it('센서 축 글자(X·Y·Z)는 단계 0에서만 그려진다', () => {
    const axes = (step: StageStep) => {
      const { ctx, texts } = fakeContext();
      drawStage(ctx, frameAt(step, 0.5));
      return texts.filter((x) => ['X', 'Y', 'Z'].includes(x.text)).length;
    };
    expect(axes(0)).toBe(3);
    expect(axes(1)).toBe(0);
    expect(axes(2)).toBe(0);
  });

  it('단계 1에서 패드 이름 3개가 그려진다', () => {
    const { ctx, texts } = fakeContext();
    drawStage(ctx, frameAt(1, 0.5));
    expect(texts.map((x) => x.text).sort()).toEqual(['HI-HAT', 'SNARE', 'TOM']);
  });

  it('폭 360에서도 모든 글자가 9px 이상이다', () => {
    for (const step of [0, 1, 2] as StageStep[]) {
      const { ctx, texts } = fakeContext();
      drawStage(ctx, frameAt(step, 0.5, 360));
      expect(texts.length).toBeGreaterThan(0);
      for (const { font } of texts) {
        const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1]);
        expect(px).toBeGreaterThanOrEqual(9);
      }
    }
  });

  it('폭 520에서 패드 이름은 10.5px이다', () => {
    const { ctx, texts } = fakeContext();
    drawStage(ctx, frameAt(1, 0.5, 520));
    expect(texts.find((x) => x.text === 'HI-HAT')?.font).toContain('10.5px');
  });

  it('층 투명도가 0이면 패드 이름·블루투스 글자를 그리지 않는다', () => {
    const { ctx, texts } = fakeContext();
    drawStage(ctx, frameAt(0, 0.5, 520, { pad: 0, imu: 0, ble: 0 }));
    expect(texts).toHaveLength(0);
  });
});

describe('bleChipName', () => {
  const hit = (time: number, name: string) => ({
    time,
    stick: 0,
    padIndex: 0,
    hitPoint: [0, 0, 0] as [number, number, number],
    strength: 1,
    name,
  });

  it('타격이 없으면 SNARE', () => {
    expect(bleChipName([], 1).name).toBe('SNARE');
  });

  it('나이가 0.18초 이상인 가장 최근 타격의 이름을 쓰고, 번쩍임 기준은 그 시각 + 0.18', () => {
    const hits = [hit(1.0, 'TOM'), hit(1.4, 'HI-HAT'), hit(1.5, 'SNARE')];
    const chip = bleChipName(hits, 1.62); // 1.5는 나이 0.12라 아직, 1.4는 0.22
    expect(chip.name).toBe('HI-HAT');
    expect(chip.flashAt).toBeCloseTo(1.58);
  });

  it('실제 타격 목록에서도 계산된다', () => {
    const base = buildLayoutA();
    const t = 4 * BEAT + 0.03;
    const name = bleChipName(hitsBetween(base, t - 1, t, 2), t).name;
    expect(['SNARE', 'HI-HAT', 'TOM']).toContain(name);
  });
});

describe('parseCssColor', () => {
  it('#rrggbb·#rgb·rgb()를 읽는다', () => {
    expect(parseCssColor('#35a3d4')[0]).toBeCloseTo(0x35 / 255);
    expect(parseCssColor(' #fff ')).toEqual([1, 1, 1]);
    expect(parseCssColor('rgb(255, 0, 51)')).toEqual([1, 0, 0.2]);
  });

  it('읽을 수 없으면 기본 브랜드색', () => {
    expect(parseCssColor('')).toEqual(DEFAULT_BRAND);
    expect(parseCssColor('var(--x)')).toEqual(DEFAULT_BRAND);
  });
});
