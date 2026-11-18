// 드럼 배치 원근 보기 좌표 계산 검증(PLAY-004 원근 보기): 투영·역투영, 배치 ↔ 3D 점, 끌기, 겹침 순서·클릭 판정, 스틱 끝점.
import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT_LAYOUT } from './kitLayout';
import { ALL_PADS, type PadId } from './pads';
import {
  AIM_ORIGIN,
  FLOOR_Z,
  PAD_SOLIDS,
  VIEW_EDGE,
  kitShapes,
  makeCamera,
  padPoint,
  padReach,
  padShape,
} from './kitPerspective';

const BOX = { w: 1000, h: 625 };
const cam = makeCamera(BOX);
const shapes = kitShapes(DEFAULT_KIT_LAYOUT, cam);
const shapeOf = (pad: PadId) => shapes.find((s) => s.pad === pad)!;

describe('makeCamera', () => {
  it('그림 자리(place)는 세로·크기·깊이가 원근 투영과 같고 가로만 다르다', () => {
    const pt = [0.3, 0.6, 0.2] as const;
    const q = cam.project(pt);
    const p = cam.place(pt);
    expect(p.sy).toBe(q.sy);
    expect(p.scale).toBe(q.scale);
    expect(p.depth).toBe(q.depth);
  });

  it('가로 자리는 기준점에서 본 방위각에 비례한다: 같은 방위각이면 거리·높이와 상관없이 같은 가로 자리', () => {
    // 방위각 30°: 가까운 점과 먼 점, 낮은 점과 높은 점
    const dir = [Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
    const near = cam.place([AIM_ORIGIN[0] + dir[0] * 0.4, AIM_ORIGIN[1] + dir[1] * 0.4, -0.2]);
    const far = cam.place([AIM_ORIGIN[0] + dir[0] * 1.1, AIM_ORIGIN[1] + dir[1] * 1.1, 0.5]);
    expect(near.sx).toBeCloseTo(far.sx, 6);
    // 정면은 가로 가운데, 반대쪽 각도는 가운데를 두고 대칭
    expect(cam.place([AIM_ORIGIN[0], 0.7, 0]).sx).toBeCloseTo(BOX.w / 2, 6);
    const left = cam.place([AIM_ORIGIN[0] - dir[0] * 0.4, AIM_ORIGIN[1] + dir[1] * 0.4, -0.2]);
    expect(left.sx + near.sx).toBeCloseTo(BOX.w, 6);
  });

  it.each([BOX, { w: 1004, h: 468 }, { w: 600, h: 600 }])('배치 가로 끝(x 0.05·0.95)의 스틱 패드 중심은 그림 영역 끝에서 기준 길이의 10% 안쪽에 온다 %o', (box) => {
    const c = makeCamera(box);
    const edge = Math.min(box.w, box.h * 1.6) * VIEW_EDGE;
    for (const pad of ['SNARE', 'HIHAT', 'CRASH', 'FLOOR_TOM'] as const) {
      expect(padShape(pad, padPoint(pad, { x: 0.05, y: 0.5 }), c).cx).toBeCloseTo(edge, 4);
      expect(padShape(pad, padPoint(pad, { x: 0.95, y: 0.3 }), c).cx).toBeCloseTo(box.w - edge, 4);
    }
  });

  it('layoutXAt은 place 가로 자리의 역변환이다', () => {
    for (const x of [0.05, 0.3, 0.5, 0.8, 0.95]) {
      const s = padShape('MID_TOM', padPoint('MID_TOM', { x, y: 0.4 }), cam);
      expect(cam.layoutXAt(s.cx)).toBeCloseTo(x, 6);
    }
  });

  it('먼 점은 작고 화면 위쪽에, 높은 점은 화면 위쪽에 놓인다', () => {
    const near = cam.project([0, 0.2, 0]);
    const far = cam.project([0, 1.0, 0]);
    expect(far.scale).toBeLessThan(near.scale);
    expect(far.sy).toBeLessThan(near.sy);
    expect(cam.project([0, 0.5, 0.4]).sy).toBeLessThan(cam.project([0, 0.5, 0]).sy);
  });

  it('넓은 판(높이 기준)과 16:10은 같은 높이면 그림 크기가 같다', () => {
    expect(makeCamera({ w: 2000, h: 625 }).focal).toBeCloseTo(cam.focal, 6);
  });
});

describe('padPoint', () => {
  it('스틱 패드는 기준점에서 모델 거리만큼 떨어져 있다', () => {
    const p = padPoint('SNARE', DEFAULT_KIT_LAYOUT.SNARE);
    expect(Math.hypot(p[0] - AIM_ORIGIN[0], p[1] - AIM_ORIGIN[1], p[2] - AIM_ORIGIN[2])).toBeCloseTo(padReach('SNARE'), 6);
  });

  it('배치에서 위쪽(y 작음) 패드가 더 높고, 오른쪽 패드가 x가 크다', () => {
    expect(padPoint('CRASH', DEFAULT_KIT_LAYOUT.CRASH)[2]).toBeGreaterThan(padPoint('SNARE', DEFAULT_KIT_LAYOUT.SNARE)[2]);
    expect(padPoint('RIDE', DEFAULT_KIT_LAYOUT.RIDE)[0]).toBeGreaterThan(padPoint('CRASH', DEFAULT_KIT_LAYOUT.CRASH)[0]);
  });

  it('하이햇 페달의 3D 점은 하이햇 바로 아래 바닥이다(하이햇의 배치 좌표를 넘긴다)', () => {
    const hh = padPoint('HIHAT', DEFAULT_KIT_LAYOUT.HIHAT);
    const pedal = padPoint('HIHAT_PEDAL', DEFAULT_KIT_LAYOUT.HIHAT);
    expect(pedal[0]).toBe(hh[0]);
    expect(pedal[1]).toBe(hh[1]);
    expect(pedal[2]).toBeLessThan(-0.5);
  });

  it('킥은 자리가 고정이다: 배치 좌표와 무관하게 바닥에 서고(중심 높이 = 바닥 + 반지름) 화면 가로 가운데에 놓인다', () => {
    const a = padPoint('KICK', { x: 0.6, y: 0.9 });
    expect(a).toEqual(padPoint('KICK', { x: 0.1, y: 0.2 }));
    expect(a[2]).toBeCloseTo(FLOOR_Z + PAD_SOLIDS.KICK.radius, 6);
    expect(shapeOf('KICK').cx).toBeCloseTo(BOX.w / 2, 6);
  });
});

describe('kitShapes', () => {
  it('패드 9개를 먼 것부터 준다', () => {
    expect(shapes).toHaveLength(9);
    for (let i = 1; i < shapes.length; i++) expect(shapes[i].depth).toBeLessThanOrEqual(shapes[i - 1].depth);
  });

  it('드럼은 통 옆면, 심벌은 스탠드, 킥·페달은 그림자 없음', () => {
    expect(shapeOf('FLOOR_TOM').wall).toBeGreaterThan(0);
    expect(shapeOf('FLOOR_TOM').stand).toBe(0);
    expect(shapeOf('CRASH').stand).toBeGreaterThan(0);
    expect(shapeOf('CRASH').wall).toBe(0);
    expect(shapeOf('KICK').shadow).toBeNull();
    expect(shapeOf('SNARE').shadow).not.toBeNull();
  });

  it('윗면은 눌린 타원이다(세로 반지름 < 가로 반지름)', () => {
    for (const s of shapes) {
      if (s.kind === 'kick') continue;
      expect(s.ry).toBeLessThan(s.rx);
      expect(s.ry).toBeGreaterThan(0);
    }
    // 킥은 연주자를 향해 서 있어 원이다
    expect(shapeOf('KICK').ry).toBe(shapeOf('KICK').rx);
  });

  it.each([BOX, { w: 1400, h: 520 }, { w: 600, h: 600 }])('기본 배치가 그림 영역 안에 들어온다 %o', (box) => {
    for (const s of kitShapes(DEFAULT_KIT_LAYOUT, makeCamera(box))) {
      expect(s.cx - s.rx).toBeGreaterThan(0);
      expect(s.cx + s.rx).toBeLessThan(box.w);
      expect(s.cy - s.ry).toBeGreaterThan(0);
      expect(s.cy + s.ry + s.wall).toBeLessThan(box.h);
    }
  });
});

describe('기본 배치(DEFAULT_KIT_LAYOUT)', () => {
  it.each([BOX, { w: 1400, h: 520 }, { w: 600, h: 600 }])('원근 그림에서 킥을 뺀 어느 두 패드의 윗면도 겹치지 않는다 %o', (box) => {
    // 킥은 세워진 베이스 드럼이라 실제처럼 스네어·플로어탐 뒤에 일부 가려진다(아래 테스트에서 가운데가 보이는지 본다)
    const list = kitShapes(DEFAULT_KIT_LAYOUT, makeCamera(box)).filter((s) => s.kind !== 'kick');
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        // 타원끼리의 겹침을 넉넉하게 본다: 세로 거리를 타원 눌림만큼 늘려 원으로 비교
        const squash = Math.min(a.rx / a.ry, b.rx / b.ry);
        expect(Math.hypot(a.cx - b.cx, (a.cy - b.cy) * squash)).toBeGreaterThan(a.rx + b.rx);
      }
    }
  });
});

describe('PAD_SOLIDS', () => {
  it('모든 패드에 크기가 있다', () => {
    for (const pad of ALL_PADS) expect(PAD_SOLIDS[pad].radius).toBeGreaterThan(0);
  });
});

describe('하이햇 페달', () => {
  it('기본 배치: 화면에서 하이햇 바로 아래에 붙어 있다', () => {
    const hh = shapeOf('HIHAT');
    const pedal = shapeOf('HIHAT_PEDAL');
    // 받침 그림의 페달 자리라 가로는 거의 같고(하이햇 반지름의 1/10 이내) 세로로 아래다
    expect(Math.abs(pedal.cx - hh.cx)).toBeLessThan(hh.rx / 10);
    expect(pedal.cy).toBeGreaterThan(hh.cy + hh.ry);
    // 하이햇보다 살짝 앞이라 받침 위에 그려진다
    expect(pedal.depth).toBeLessThan(hh.depth);
  });

  it('하이햇을 옮기면 따라간다: 배치의 페달 좌표와 무관하게 하이햇과의 간격·크기 비가 같다', () => {
    const gap = (layout: typeof DEFAULT_KIT_LAYOUT) => {
      const list = kitShapes(layout, cam);
      const hh = list.find((s) => s.pad === 'HIHAT')!;
      const pedal = list.find((s) => s.pad === 'HIHAT_PEDAL')!;
      return { dx: (pedal.cx - hh.cx) / hh.rx, drop: (pedal.cy - hh.cy) / hh.rx, size: pedal.rx / hh.rx };
    };
    const base = gap(DEFAULT_KIT_LAYOUT);
    const moved = gap({ ...DEFAULT_KIT_LAYOUT, HIHAT: { ...DEFAULT_KIT_LAYOUT.HIHAT, x: 0.7, y: 0.2 }, HIHAT_PEDAL: { ...DEFAULT_KIT_LAYOUT.HIHAT_PEDAL, x: 0.1 } });
    expect(moved.dx).toBeCloseTo(base.dx, 6);
    expect(moved.drop).toBeCloseTo(base.drop, 6);
    expect(moved.size).toBeCloseTo(base.size, 6);
  });
});
