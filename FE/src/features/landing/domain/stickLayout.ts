// 랜딩 스틱 무대 구도 A(연주자 시점)의 카메라·패드·스틱 배치. 다른 구도는 만들지 않는다.

import { FULCRUM_Y, L_TOTAL, CONTACT_PHI, REACH_H } from './stickModel';
import { MAX_THETA, LIFT, pointOnAxis } from './stickStroke';
import { makeCamera, TAU, type StageCamera, type Vec3 } from './stickSpace';

// 0 측정, 1 판별, 2 전달 (stickStep이 주는 단계)
export type StageStep = 0 | 1 | 2;

export interface StagePad {
  name: string;
  // 바닥 위 중심
  center: Vec3;
  radius: number;
}

// 패드를 칠 때의 목표
export interface StickTarget {
  // 타격점(팁이 닿는 바닥 위 점)
  hitPoint: Vec3;
  // 받침점(손 위치)
  fulcrum: Vec3;
  // 바닥 위 진행 방향(손에서 패드 쪽)
  heading: Vec3;
}

export interface StageStick {
  hand: 'R' | 'L';
  // 오른손 0
  index: number;
  // 패드 번호 순서
  sequence: number[];
  // 패드별 목표
  targets: StickTarget[];
}

export interface StageLayout {
  camera: StageCamera;
  pads: StagePad[];
  // 단계 0에서 두 손이 모두 치는 패드 번호
  mainPad: number;
  sticks: StageStick[];
}

export interface StickPose {
  fulcrum: Vec3;
  heading: Vec3;
  // 손잡이에서 팁 쪽 단위 벡터
  direction: Vec3;
  // 타격면에서 든 각(라디안)
  theta: number;
  // 이 손의 타격 번호(주기)
  period: number;
  // 직전에 친 패드
  padIndex: number;
  // 전체 타격 번호
  hitIndex: number;
}

export interface StageHit {
  // 타격 시각(초)
  time: number;
  // 친 손(스틱 번호)
  stick: number;
  padIndex: number;
  hitPoint: Vec3;
  // 세기 0~1
  strength: number;
  // 패드 이름
  name: string;
}

interface HandSpec {
  hand: 'R' | 'L';
  home: [number, number];
  dx: number;
  seq: number[];
}

const PADS: StagePad[] = [
  { name: 'SNARE', center: [0, 0, 8], radius: 12 },
  { name: 'HI-HAT', center: [-22, 0, 12], radius: 9.5 },
  { name: 'TOM', center: [22, 0, 12], radius: 9.5 },
];

const HANDS: HandSpec[] = [
  { hand: 'R', home: [13, -60], dx: 2.6, seq: [0, 0, 2, 0] },
  { hand: 'L', home: [-13, -60], dx: -2.6, seq: [0, 1, 0, 0] },
];

// 구도 A: 눈 (0, 44, -42), 바라보는 점 (0, 0, 5). 카메라 배율·오프셋은 fitCamera가 채운다.
export function buildLayoutA(): StageLayout {
  const camera = makeCamera([0, 44, -42], [0, 0, 5]);
  const pads = PADS.map((p) => ({ ...p, center: [...p.center] as Vec3 }));
  const sticks: StageStick[] = HANDS.map((s, i) => ({
    hand: s.hand,
    index: i,
    sequence: [...s.seq],
    targets: pads.map((p): StickTarget => {
      const hitPoint: Vec3 = [p.center[0] + s.dx, 0, p.center[2]];
      let hx = s.home[0] - hitPoint[0];
      let hz = s.home[1] - hitPoint[2];
      const l = Math.hypot(hx, hz);
      hx /= l;
      hz /= l;
      return {
        hitPoint,
        fulcrum: [hitPoint[0] + hx * REACH_H, FULCRUM_Y, hitPoint[2] + hz * REACH_H],
        heading: [-hx, 0, -hz],
      };
    }),
  }));
  return { camera, pads, mainPad: 0, sticks };
}

// fitCamera에 줄 점 목록: 패드 둘레, 모든 목표에서 접촉 자세와 가장 높이 든 자세의 스틱 양 끝
export function layoutBounds(layout: StageLayout): Vec3[] {
  const pts: Vec3[] = [];
  for (const p of layout.pads) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      pts.push([p.center[0] + Math.cos(a) * p.radius, 0, p.center[2] + Math.sin(a) * p.radius]);
    }
  }
  for (const stick of layout.sticks) {
    for (const t of stick.targets) {
      for (const theta of [0, MAX_THETA]) {
        const phi = CONTACT_PHI + theta;
        const c = Math.cos(phi);
        const pose = {
          fulcrum: [t.fulcrum[0], FULCRUM_Y + LIFT * (theta / MAX_THETA), t.fulcrum[2]] as Vec3,
          direction: [t.heading[0] * c, Math.sin(phi), t.heading[2] * c] as Vec3,
        };
        pts.push(pointOnAxis(pose, 0), pointOnAxis(pose, L_TOTAL));
      }
    }
  }
  return pts;
}
