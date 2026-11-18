// 실수 안내 좌표(hintGeometry) 검증(PLAY-004 v0.4): 패드 링이 킷 상자 안에 있고, 멀어질 방향·가장자리 거리·방향 그림 각도가 맞다.
import { describe, expect, it } from 'vitest';
import { CAPTURE_ORDER } from '@/engine/HitCapture';
import { KIT_SKINS } from '@/domain/kit/drumKit';
import { aimPose, awayVector, hintBox, padRing, ringEdge } from './hintGeometry';

describe('padRing', () => {
  it('보정하는 7패드의 링 중심이 스킨마다 킷 상자 안에 있다', () => {
    for (const skin of KIT_SKINS) {
      const box = hintBox(skin);
      for (const pad of CAPTURE_ORDER) {
        const r = padRing(skin, pad);
        expect(r, `${skin} ${pad}`).not.toBeNull();
        if (!r) continue;
        expect(r.cx).toBeGreaterThan(0);
        expect(r.cx).toBeLessThan(box.w);
        expect(r.cy).toBeGreaterThan(0);
        expect(r.cy).toBeLessThan(box.h);
        expect(r.rx).toBeGreaterThan(0);
        expect(r.ry).toBeGreaterThan(0);
      }
    }
  });
});

describe('awayVector·ringEdge', () => {
  const ring = (cx: number, cy: number) => ({ cx, cy, rx: 40, ry: 20 });

  it('이웃에서 칠 패드로 가는 단위 벡터', () => {
    expect(awayVector(ring(0, 0), ring(30, 40))).toEqual({ ux: 0.6, uy: 0.8 });
  });

  it('두 중심이 거의 같으면 위쪽', () => {
    expect(awayVector(ring(10, 10), ring(10.2, 10))).toEqual({ ux: 0, uy: -1 });
  });

  it('타원 가장자리까지의 거리: 가로는 rx, 세로는 ry', () => {
    expect(ringEdge(ring(0, 0), 1, 0)).toBeCloseTo(40);
    expect(ringEdge(ring(0, 0), 0, -1)).toBeCloseTo(20);
  });

  it('실물 그림에서 크래시는 하이햇의 위쪽·오른쪽에 있다(멀어질 방향이 쌍별 문구 「더 높이」와 맞는다)', () => {
    const hihat = padRing('acoustic', 'HIHAT');
    const crash = padRing('acoustic', 'CRASH');
    expect(hihat && crash).toBeTruthy();
    if (!hihat || !crash) return;
    expect(awayVector(hihat, crash).uy).toBeLessThan(0);
  });
});

describe('aimPose', () => {
  it('왼손 크래시는 왼쪽 위, 오른손 라이드는 오른쪽 위, 스네어는 아래', () => {
    const crash = aimPose(0, 'CRASH');
    expect(crash?.yaw).toBeLessThan(0);
    expect(crash?.pitch).toBeGreaterThan(0);
    const ride = aimPose(1, 'RIDE');
    expect(ride?.yaw).toBeGreaterThan(0);
    expect(ride?.pitch).toBeGreaterThan(0);
    expect(aimPose(0, 'SNARE')?.pitch).toBeLessThan(0);
  });

  it('그림 범위로 자르고, 스틱으로 치지 않는 패드는 null', () => {
    for (const pad of CAPTURE_ORDER) {
      for (const h of [0, 1] as const) {
        const p = aimPose(h, pad);
        expect(Math.abs(p?.yaw ?? 0)).toBeLessThanOrEqual(80);
        expect(Math.abs(p?.pitch ?? 0)).toBeLessThanOrEqual(60);
      }
    }
    expect(aimPose(0, 'KICK')).toBeNull();
    expect(aimPose(1, 'HIHAT_PEDAL')).toBeNull();
  });
});
