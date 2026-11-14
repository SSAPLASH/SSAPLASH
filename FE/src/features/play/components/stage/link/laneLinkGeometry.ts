// 레인 → 패드 연결 경로 계산(설계 MODE-001-game-neon-link). 캔버스·DOM을 모르는 순수 함수.
// 좌표는 연결 층 기준: 왼쪽 위가 (0, 0)이고 y 0이 판정선이다. 킷은 판정선 아래 LINK_ZONE_H에서 시작하고 가로 가운데에 놓인다.
import { DRUM_KIT_FLAT_PADS, DRUM_KIT_W, visualPadOf } from '@/domain/kit/drumKit';
import type { PadId } from '@/domain/kit/pads';
import { highwayLayout, JUDGE_FROM_BOTTOM, laneCenterX } from '@/features/play/components/stage/highway/highwayGeometry';

/** 판정선과 킷 사이 연결 구역 높이(px). 하이웨이의 판정선 아래 길이와 같다 */
export const LINK_ZONE_H = JUDGE_FROM_BOTTOM;
/** 꺾이는 곳에서 모서리를 비스듬히 자르는 길이(px) */
export const LINK_CORNER = 9;
/** 리듬 게임 킷 배율: 화면 높이가 GAME_KIT_TALL_MIN_HEIGHT 이상이면 큰 값 */
export const GAME_KIT_SCALE = 0.6;
export const GAME_KIT_SCALE_TALL = 0.7;
export const GAME_KIT_TALL_MIN_HEIGHT = 820;

export function gameKitScale(tall: boolean): number {
  return tall ? GAME_KIT_SCALE_TALL : GAME_KIT_SCALE;
}

export type LinkPoint = readonly [number, number];

export interface LaneLink {
  /** 하이웨이 레인(채보 패드) */
  lane: PadId;
  /** 이어지는 킷 패드. 하이햇 페달은 하이햇 */
  pad: PadId;
  /** 가이드 점선 경로: 판정선 아래 → 패드 윗선 */
  points: LinkPoint[];
  /** 타격 띠 경로: 같은 길을 패드 안쪽까지 */
  band: LinkPoint[];
  bandWidth: number;
}

/** 시작점은 판정선 아래 이만큼 */
const START_GAP = 8;
/** 노트 폭 = 레인 폭 × 이 값(NoteHighway와 같다) */
const NOTE_W_RATIO = 0.57;

/** 가장 높이 꺾이는 선의 높이(판정선 기준 px)와 선 사이 간격 */
const LEVEL_TOP = 20;
const LEVEL_STEP = 8;
/** 가장 낮게 꺾이는 선의 높이 한계: 모서리를 자른 뒤에도 연결 구역 안에 남는다 */
const LEVEL_MAX = LINK_ZONE_H - LINK_CORNER - 3;

/**
 * 레인별 꺾이는 높이(판정선 기준 px). dxs는 레인 순서대로 (패드 x − 레인 x)다.
 * 왼쪽으로 가는 선은 오른쪽 레인일수록 낮게, 오른쪽으로 가는 선은 왼쪽 레인일수록 낮게 꺾어야 가로 구간이 이웃 선의 세로 구간과 엇갈리지 않는다.
 * 킷 배율에 따라 방향이 바뀌는 레인이 있어(크래시·스네어) 순번이 아니라 방향으로 나눈다.
 */
export function linkLevels(dxs: readonly number[]): number[] {
  const right = dxs.map((dx, i) => (dx > 0 ? i : -1)).filter((i) => i >= 0);
  const left = dxs.map((dx, i) => (dx > 0 ? -1 : i)).filter((i) => i >= 0);
  const most = Math.max(right.length, left.length);
  const step = most > 1 ? Math.min(LEVEL_STEP, (LEVEL_MAX - LEVEL_TOP) / (most - 1)) : 0;
  const out = dxs.map(() => LEVEL_TOP);
  right.forEach((lane, k) => (out[lane] = LEVEL_TOP + (right.length - 1 - k) * step));
  left.forEach((lane, k) => (out[lane] = LEVEL_TOP + k * step));
  return out;
}

/** 아래 → 옆 → 아래로 꺾이는 길. 꺾이는 곳마다 모서리를 자른다 */
function cutPath(x0: number, y0: number, x1: number, y1: number, level: number): LinkPoint[] {
  const dx = x1 - x0;
  if (Math.abs(dx) < 1) return [[x0, y0], [x1, y1]];
  const c = Math.min(LINK_CORNER, Math.abs(dx) / 2);
  const sg = dx > 0 ? 1 : -1;
  return [[x0, y0], [x0, level - c], [x0 + sg * c, level], [x1 - sg * c, level], [x1, level + c], [x1, y1]];
}

export interface LaneLinksInput {
  /** 연결 층(= 하이웨이) 폭 */
  width: number;
  kitScale: number;
  lanes: readonly PadId[];
}

export function laneLinks({ width, kitScale, lanes }: LaneLinksInput): LaneLink[] {
  if (!(width > 0)) return [];
  const s = Math.min(kitScale, width / DRUM_KIT_W);
  const kitX = (width - DRUM_KIT_W * s) / 2;
  const layout = highwayLayout(width, 0, lanes.length);
  const ends = lanes.map((lane, i) => {
    const pad = visualPadOf(lane);
    const kp = DRUM_KIT_FLAT_PADS.find((p) => p.pad === pad);
    if (!pad || !kp) return null;
    const r = (kp.w / 2) * s;
    const px = kitX + (kp.left + kp.w / 2) * s;
    const py = LINK_ZONE_H + (kp.top + kp.h / 2) * s;
    const pedal = lane !== pad;
    // 페달 레인은 하이햇 패드의 왼쪽 위로 들어간다(하이햇 레인의 선과 겹치지 않게)
    return { lane, pad, r, py, pedal, x0: laneCenterX(layout, i), x1: pedal ? px - r * 0.66 : px, y1: pedal ? py - r * 0.66 : py - r * 0.92 };
  });
  const levels = linkLevels(ends.map((e) => (e ? e.x1 - e.x0 : 0)));
  const out: LaneLink[] = [];
  ends.forEach((e, i) => {
    if (!e) return;
    const points = cutPath(e.x0, START_GAP, e.x1, e.y1, levels[i]);
    const band = e.pedal ? points : [...points.slice(0, -1), [e.x1, e.py - e.r * 0.5] as LinkPoint];
    const bandWidth = Math.min(layout.laneW * NOTE_W_RATIO, e.r * 2 * 0.65) * (e.pedal ? 0.6 : 1);
    out.push({ lane: e.lane, pad: e.pad, points, band, bandWidth });
  });
  return out;
}
