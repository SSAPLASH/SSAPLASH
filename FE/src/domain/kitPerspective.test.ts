// 드럼 배치 원근 보기 좌표 계산 검증(PLAY-004 원근 보기): 투영·역투영, 배치 ↔ 3D 점, 끌기, 겹침 순서·클릭 판정, 스틱 끝점.
import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT_LAYOUT } from './kitLayout';
import { screenToPose } from './kitMapping';
import { ALL_PADS, type PadId } from './pads';
import {
  AIM_ORIGIN,
  PAD_SOLIDS,
  dragToLayout,
  hitTestPads,
  kitShapes,
  makeCamera,
  padPoint,
  padPointCm,
  padReach,
  padScreenCircles,
  padShape,
  poseTip,
  screenPointToPose,
} from './kitPerspective';

const BOX = { w: 1000, h: 625 };
const cam = makeCamera(BOX);
const shapes = kitShapes(DEFAULT_KIT_LAYOUT, cam);
const shapeOf = (pad: PadId) => shapes.find((s) => s.pad === pad)!;

describe('makeCamera', () => {
  it('투영한 점을 같은 깊이로 되돌리면 원래 점이다', () => {
    const pt = [0.3, 0.6, 0.2] as const;
    const q = cam.project(pt);
    const back = cam.unproject(q.sx, q.sy, q.depth);
    for (const i of [0, 1, 2]) expect(back[i]).toBeCloseTo(pt[i], 6);
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

  it('페달은 바닥 가까이 고정 줄에 있고 배치 y와 무관하다', () => {
    const a = padPoint('KICK', { x: 0.58, y: 0.9 });
    const b = padPoint('KICK', { x: 0.58, y: 0.3 });
    expect(a).toEqual(b);
    expect(a[2]).toBeLessThan(-0.5);
  });

  it('padPointCm은 같은 점을 cm로 준다', () => {
    const p = padPoint('HIHAT', DEFAULT_KIT_LAYOUT.HIHAT);
    const cm = padPointCm('HIHAT', DEFAULT_KIT_LAYOUT.HIHAT);
    expect(cm.x).toBeCloseTo(p[0] * 100, 6);
    expect(cm.z).toBeCloseTo(p[2] * 100, 6);
  });
});

describe('kitShapes', () => {
  it('패드 9개를 먼 것부터 준다', () => {
    expect(shapes).toHaveLength(9);
    for (let i = 1; i < shapes.length; i++) expect(shapes[i].depth).toBeLessThanOrEqual(shapes[i - 1].depth);
  });

  it('드럼은 통 옆면, 심벌은 스탠드, 페달은 그림자 없음', () => {
    expect(shapeOf('FLOOR_TOM').wall).toBeGreaterThan(0);
    expect(shapeOf('FLOOR_TOM').stand).toBe(0);
    expect(shapeOf('CRASH').stand).toBeGreaterThan(0);
    expect(shapeOf('CRASH').wall).toBe(0);
    expect(shapeOf('KICK').shadow).toBeNull();
    expect(shapeOf('SNARE').shadow).not.toBeNull();
  });

  it('윗면은 눌린 타원이다(세로 반지름 < 가로 반지름)', () => {
    for (const s of shapes) {
      expect(s.ry).toBeLessThan(s.rx);
      expect(s.ry).toBeGreaterThan(0);
    }
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
  it.each([BOX, { w: 1400, h: 520 }, { w: 600, h: 600 }])('원근 그림에서 어느 두 패드의 윗면도 겹치지 않는다 %o', (box) => {
    const list = kitShapes(DEFAULT_KIT_LAYOUT, makeCamera(box));
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

describe('hitTestPads', () => {
  it('패드 윗면 중심을 누르면 그 패드다', () => {
    for (const pad of ['CRASH', 'RIDE', 'KICK', 'HIHAT_PEDAL', 'FLOOR_TOM'] as const) {
      const s = shapeOf(pad);
      expect(hitTestPads(shapes, s.cx, s.cy)).toBe(pad);
    }
  });

  it('통 옆면도 그 드럼이다', () => {
    const s = shapeOf('FLOOR_TOM');
    expect(hitTestPads(shapes, s.cx, s.cy + s.ry + s.wall * 0.5)).toBe('FLOOR_TOM');
  });

  it('빈 자리는 null', () => {
    expect(hitTestPads(shapes, 5, 5)).toBeNull();
  });

  it('겹친 자리에서는 앞에 보이는(가까운) 패드를 잡는다', () => {
    const far = padShape('CRASH', [0, 0.9, 0], cam);
    const near = padShape('SNARE', [0, 0.3, 0], cam);
    // 가까운 패드의 윗면 중심에 먼 패드를 겹쳐 놓는다
    const overlapFar = { ...far, cx: near.cx, cy: near.cy };
    expect(hitTestPads([overlapFar, near], near.cx, near.cy)).toBe('SNARE');
  });
});

describe('dragToLayout', () => {
  it('제자리에서는 배치가 그대로다', () => {
    for (const pad of ['SNARE', 'CRASH', 'RIDE', 'MID_TOM'] as const) {
      const s = shapeOf(pad);
      const next = dragToLayout(pad, s.cx, s.cy, DEFAULT_KIT_LAYOUT[pad], cam);
      expect(next.x).toBeCloseTo(DEFAULT_KIT_LAYOUT[pad].x, 6);
      expect(next.y).toBeCloseTo(DEFAULT_KIT_LAYOUT[pad].y, 6);
    }
  });

  it('옮긴 뒤 다시 그리면 패드 중심이 포인터 자리에 있다', () => {
    for (const [dx, dy] of [
      [60, 0],
      [-50, 30],
      [0, -70],
      [40, 50],
    ]) {
      // 가운데쯤 있는 패드라 옮겨도 0.05~0.95 한계에 닿지 않는다
      const s = shapeOf('MID_TOM');
      const next = dragToLayout('MID_TOM', s.cx + dx, s.cy + dy, DEFAULT_KIT_LAYOUT.MID_TOM, cam);
      const moved = padShape('MID_TOM', padPoint('MID_TOM', next), cam);
      expect(Math.hypot(moved.cx - (s.cx + dx), moved.cy - (s.cy + dy))).toBeLessThan(1);
    }
  });

  it('범위를 넘으면 0.05~0.95로 자른다', () => {
    for (const [px, py] of [
      [50000, -50000],
      [-50000, 50000],
      [BOX.w, 0],
    ]) {
      const next = dragToLayout('SNARE', px, py, DEFAULT_KIT_LAYOUT.SNARE, cam);
      expect(next.x).toBeGreaterThanOrEqual(0.05);
      expect(next.x).toBeLessThanOrEqual(0.95);
      expect(next.y).toBeGreaterThanOrEqual(0.05);
      expect(next.y).toBeLessThanOrEqual(0.95);
    }
    // 오른쪽 끝으로 끌면 오른쪽 한계에 닿는다
    expect(dragToLayout('SNARE', BOX.w, shapeOf('SNARE').cy, DEFAULT_KIT_LAYOUT.SNARE, cam).x).toBe(0.95);
  });

  it('페달은 좌우로만 움직이고 y는 그대로다', () => {
    const s = shapeOf('KICK');
    const next = dragToLayout('KICK', s.cx - 80, s.cy - 100, DEFAULT_KIT_LAYOUT.KICK, cam);
    expect(next.y).toBe(DEFAULT_KIT_LAYOUT.KICK.y);
    expect(next.x).toBeLessThan(DEFAULT_KIT_LAYOUT.KICK.x);
    const moved = padShape('KICK', padPoint('KICK', next), cam);
    expect(moved.cx).toBeCloseTo(s.cx - 80, 0);
  });
});

describe('poseTip', () => {
  it('가운데 출발점에서 패드의 배치 자세를 가리키면 끝점이 그 패드 가까이 닿는다', () => {
    for (const pad of ['SNARE', 'CRASH', 'RIDE'] as const) {
      const pl = DEFAULT_KIT_LAYOUT[pad];
      const tip = poseTip('center', screenToPose(pl.x, pl.y), shapes);
      const p = shapeOf(pad).point;
      expect(Math.hypot(tip[0] - p[0], tip[1] - p[1], tip[2] - p[2])).toBeLessThan(0.05);
    }
  });

  it('손 출발점은 좌우로 다르다', () => {
    const pose = { pitch: 0, yaw: 0 };
    expect(poseTip(0, pose, shapes)[0]).toBeLessThan(poseTip(1, pose, shapes)[0]);
  });
});

describe('screenPointToPose', () => {
  it('패드 윗면 중심 위에서는 그 패드의 배치 자세다', () => {
    for (const pad of ['SNARE', 'HIHAT', 'CRASH', 'FLOOR_TOM'] as const) {
      const s = shapeOf(pad);
      const pose = screenPointToPose(s.cx, s.cy, shapes, cam);
      const want = screenToPose(DEFAULT_KIT_LAYOUT[pad].x, DEFAULT_KIT_LAYOUT[pad].y);
      expect(pose.yaw).toBeCloseTo(want.yaw, 4);
      expect(pose.pitch).toBeCloseTo(want.pitch, 4);
    }
  });

  it('패드 밖에서도 자세를 준다(가장 가까운 패드의 깊이 면)', () => {
    const pose = screenPointToPose(10, 10, shapes, cam);
    expect(Number.isFinite(pose.yaw)).toBe(true);
    expect(Number.isFinite(pose.pitch)).toBe(true);
  });
});

describe('padScreenCircles', () => {
  it('모든 패드의 원을 그림 영역 정규 좌표로 준다', () => {
    const circles = padScreenCircles(DEFAULT_KIT_LAYOUT, BOX);
    for (const pad of ALL_PADS) {
      const c = circles[pad];
      expect(c.x).toBeGreaterThan(0);
      expect(c.x).toBeLessThan(1);
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThan(1);
      expect(c.r).toBeCloseTo(shapeOf(pad).rx / BOX.w, 6);
    }
  });
});

describe('PAD_SOLIDS', () => {
  it('모든 패드에 크기가 있다', () => {
    for (const pad of ALL_PADS) expect(PAD_SOLIDS[pad].radius).toBeGreaterThan(0);
  });
});
