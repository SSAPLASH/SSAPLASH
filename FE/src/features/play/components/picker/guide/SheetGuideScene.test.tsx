// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DRUM_KIT_W, kitBoxFor, kitPadsFor, padCenter, type KitSkin } from '@/domain/kit/drumKit';
import { PAD_META } from '@/domain/kit/pads';
import { buildGuideScript, EXAMPLE_STEPS, holdStartOf, stateAt } from '@/features/play/domain/guideScript';
import { useSettings } from '@/store/settingsStore';
import { guideKitPlace } from './guideKitPlace';
import { SCENE_H, SCENE_W, SheetGuideScene } from './SheetGuideScene';

afterEach(cleanup);

const script = buildGuideScript();
const hold0 = stateAt(script, holdStartOf(script, 0) + 1);

function renderScene(skin: KitSkin) {
  useSettings.setState({ kitSkin: skin });
  return render(<SheetGuideScene state={hold0} />).container;
}

describe('guideKitPlace', () => {
  it('전자·네온은 (57, 200)에 0.85배, persp', () => {
    for (const skin of ['electronic', 'neon'] as const) {
      expect(guideKitPlace(skin)).toEqual({ view: 'persp', scale: 0.85, x: 57, y: 200, w: DRUM_KIT_W * 0.85 });
    }
  });

  it('실물은 위에서 본 그림을 킷 칸 높이(255)에 맞추고 칸 가운데에 둔다', () => {
    const p = guideKitPlace('acoustic');
    expect(p.view).toBe('top');
    expect(p.y).toBe(200);
    expect(kitBoxFor('acoustic', 'top').h * p.scale).toBeCloseTo(255);
    expect(p.w).toBeCloseTo(DRUM_KIT_W * p.scale);
    // 칸 [57, 57 + 646] 안에서 좌우 여백이 같다
    expect(p.x - 57).toBeCloseTo(57 + 646 - (p.x + p.w));
    // 장면 안에 들어간다
    expect(p.y + kitBoxFor('acoustic', 'top').h * p.scale).toBeLessThanOrEqual(SCENE_H);
    expect(p.x + p.w).toBeLessThanOrEqual(SCENE_W);
  });
});

describe('SheetGuideScene 킷', () => {
  it('실물: 위에서 본 조각 12장을 그리고 킷 칸 폭 비율로 놓는다', () => {
    const c = renderScene('acoustic');
    const imgs = [...c.querySelectorAll('.guide-scene-kit image')].map((i) => i.getAttribute('href') ?? '');
    expect(imgs).toHaveLength(12);
    for (const u of imgs) expect(u).toContain('/top/');
    const place = guideKitPlace('acoustic');
    const box = c.querySelector<HTMLElement>('.guide-scene-kit')!;
    expect(parseFloat(box.style.left)).toBeCloseTo((place.x / SCENE_W) * 100);
    expect(parseFloat(box.style.width)).toBeCloseTo((place.w / SCENE_W) * 100);
    expect(c.querySelector('.guide-scene-kit svg')?.getAttribute('viewBox')).toBe(`0 0 ${kitBoxFor('acoustic', 'top').w} ${kitBoxFor('acoustic', 'top').h}`);
  });

  it('실물: 연결선 끝이 위에서 본 배치의 패드 헤드 중심(같은 변환)이다', () => {
    const c = renderScene('acoustic');
    const place = guideKitPlace('acoustic');
    const pads = EXAMPLE_STEPS[0]!.pads;
    const links = [...c.querySelectorAll('.guide-link')];
    expect(links).toHaveLength(pads.length);
    for (const pad of pads) {
      const kp = kitPadsFor('acoustic', 'top').find((p) => p.pad === pad)!;
      const ctr = padCenter(kp);
      const link = links.find((l) => l.getAttribute('stroke') === PAD_META[pad].color)!;
      const end = /(-?[\d.]+),(-?[\d.]+)$/.exec(link.getAttribute('d')!)!;
      expect(Number(end[1])).toBeCloseTo(place.x + ctr.x * place.scale, 5);
      expect(Number(end[2])).toBeCloseTo(place.y + ctr.y * place.scale - 22, 5);
    }
  });

  it('전자·네온: 기존처럼 평면 킷 0.85배, 연결선 끝은 평면 배치표 기준', () => {
    const c = renderScene('neon');
    expect(c.querySelectorAll('.guide-scene-kit image')).toHaveLength(0);
    expect(c.querySelector('.guide-scene-kit svg')?.getAttribute('viewBox')).toBe('0 0 760 300');
    const pad = EXAMPLE_STEPS[0]!.pads[0]!;
    const ctr = padCenter(kitPadsFor('neon').find((p) => p.pad === pad)!);
    const link = [...c.querySelectorAll('.guide-link')].find((l) => l.getAttribute('stroke') === PAD_META[pad].color)!;
    const end = /(-?[\d.]+),(-?[\d.]+)$/.exec(link.getAttribute('d')!)!;
    expect(Number(end[1])).toBeCloseTo(57 + ctr.x * 0.85, 5);
    expect(Number(end[2])).toBeCloseTo(200 + ctr.y * 0.85 - 22, 5);
  });
});
