import { describe, expect, it } from 'vitest';
import { KIT_SKINS, kitPadsFor } from '@/domain/kit/drumKit';
import { fxGeoOf } from '../geometry';
import { fxIntensity } from '../intensity';
import { createRand } from '../rand';
import { SHEET_DEFS } from '../sheets';
import { hitFxThemeDef } from '../themes';
import type { FxEvent, FxMode, FxParticle } from '../types';
import { spawnFireLite } from './fireLite';

const def = hitFxThemeDef('fire');
const palette = def.palette('acoustic', 'drum', 'x');

function runGeo(shape: 'drum' | 'cymbal' | 'kick' | 'pedal', rx: number, ry: number, seq: number, velocity = 100, mode: FxMode = 'lab') {
  const e: FxEvent = { seq, pad: 'SNARE', velocity, mode, judgement: null, deltaMs: null, combo: null };
  const geo = { cx: 300, cy: 200, rx, ry, k: rx / 57 };
  return def.spawn(e, geo, shape, fxIntensity(e), createRand(seq), palette);
}

function run(skin: (typeof KIT_SKINS)[number], pad: FxEvent['pad'], seq: number, velocity = 100, mode: FxMode = 'lab', judgement: FxEvent['judgement'] = null, view: 'persp' | 'top' = 'persp') {
  const p = kitPadsFor(skin, view).find((x) => x.pad === pad)!;
  const e: FxEvent = { seq, pad, velocity, mode, judgement, deltaMs: judgement ? 0 : null, combo: null };
  return def.spawn(e, fxGeoOf(p, skin, view), p.shape, fxIntensity(e), createRand(seq), def.palette(skin, p.shape, 'x'));
}

const sheetOf = (l: FxParticle[]) => l.find((p) => p.kind === 'sheet');

describe('fire 테마(연속 그림 + 입자)', () => {
  it('sheet가 맨 앞에 하나, 같은 seq → 같은 파티클', () => {
    for (const skin of KIT_SKINS) {
      for (const p of kitPadsFor(skin)) {
        if (p.shape === 'pedal') continue;
        const list = run(skin, p.pad, 4);
        expect(list[0]!.kind).toBe('sheet');
        expect(list.filter((x) => x.kind === 'sheet')).toHaveLength(1);
      }
    }
    expect(run('acoustic', 'SNARE', 7)).toEqual(run('acoustic', 'SNARE', 7));
    expect(run('acoustic', 'SNARE', 7)).not.toEqual(run('acoustic', 'SNARE', 8));
  });

  it('한 타는 maxSpawn(12) 이하, 수명(지연 포함)은 maxLifeMs(640) 이하 — 모든 스킨·패드·세기·모드·판정', () => {
    expect(def.maxSpawn).toBe(12);
    expect(def.maxLifeMs).toBe(640);
    for (const skin of KIT_SKINS) {
      for (const view of ['persp', 'top'] as const) {
        for (const p of kitPadsFor(skin, view)) {
          for (const v of [0, 40, 100, 127]) {
            for (const mode of ['lab', 'game', 'sheet'] as const) {
              for (const j of [null, 'PERFECT', 'GOOD'] as const) {
                const list = run(skin, p.pad, 21 + v, v, mode, j, view);
                // 페달은 지금의 Lite 함수를 그대로 쓰므로 개수는 엔진의 한 타 상한(maxSpawn)이 자른다
                if (p.shape !== 'pedal') expect(list.length).toBeLessThanOrEqual(def.maxSpawn);
                for (const x of list) {
                  expect(x.lifeMs + x.delayMs).toBeLessThanOrEqual(def.maxLifeMs);
                  expect(x.lifeMs).toBeGreaterThan(0);
                  for (const n of [x.x, x.y, x.vx, x.vy, x.size0, x.size1, x.alpha0, x.alpha1]) expect(Number.isFinite(n)).toBe(true);
                }
              }
            }
          }
        }
      }
    }
  });

  it('묶음 고르기: 납작한 드럼은 side-a/b, 심벌은 cymbal, 원판·킥은 front, 페달은 그림 없음(Lite와 같다)', () => {
    expect(['fire-side-a', 'fire-side-b']).toContain(sheetOf(runGeo('drum', 70, 24, 1))!.sheet);
    expect(sheetOf(runGeo('cymbal', 80, 20, 1))!.sheet).toBe('fire-cymbal');
    expect(sheetOf(runGeo('kick', 70, 70, 1))!.sheet).toBe('fire-front');
    expect(sheetOf(runGeo('drum', 70, 70, 1))!.sheet).toBe('fire-front');
    const e: FxEvent = { seq: 5, pad: 'HIHAT_PEDAL', velocity: 100, mode: 'lab', judgement: null, deltaMs: null, combo: null };
    const geo = { cx: 1, cy: 2, rx: 30, ry: 30, k: 0.5 };
    expect(def.spawn(e, geo, 'pedal', fxIntensity(e), createRand(5), palette)).toEqual(spawnFireLite(e, geo, 'pedal', fxIntensity(e), createRand(5), palette));
  });

  it('8번 연타하면 그림이 두 종류, 뒤집힌 것이 섞인다', () => {
    const sheets = new Set<string>();
    const mirrors = new Set<boolean>();
    for (let seq = 1; seq <= 8; seq++) {
      const s = sheetOf(runGeo('drum', 70, 24, seq))!;
      sheets.add(s.sheet!);
      mirrors.add(!!s.mirror);
    }
    expect(sheets.size).toBe(2);
    expect(mirrors.size).toBe(2);
  });

  it('그림 필드: 헤드 중심, 길이 = 묶음 길이, 밝기 0.75~1, 세기 40 < 120이면 더 크고 밝다', () => {
    const lo = sheetOf(run('acoustic', 'SNARE', 3, 40))!;
    const hi = sheetOf(run('acoustic', 'SNARE', 3, 120))!;
    expect(hi.size0).toBeGreaterThan(lo.size0);
    expect(hi.alpha0).toBeGreaterThan(lo.alpha0);
    expect(lo.alpha0).toBeGreaterThanOrEqual(0.75);
    expect(hi.alpha0).toBeLessThanOrEqual(1);
    expect(hi.lifeMs).toBe(SHEET_DEFS[hi.sheet!].durMs);
    expect(sheetOf(runGeo('drum', 70, 24, 1))).toMatchObject({ x: 300, y: 200 });
  });

  it('게임·악보 모드: 그림 ×0.72, 재생 ×1.3', () => {
    const free = sheetOf(runGeo('kick', 70, 70, 9, 127, 'free'))!;
    const game = sheetOf(runGeo('kick', 70, 70, 9, 127, 'game'))!;
    expect(game.size0 / free.size0).toBeCloseTo(0.72, 5);
    expect(game.lifeMs).toBeCloseTo(SHEET_DEFS['fire-front'].durMs / 1.3);
  });

  it('구성: 그림 1 + 헤드 달아오름 2(120ms·420ms) + 불티 4~7(40~160ms 지연, 위로), 전부 더하기', () => {
    const list = runGeo('drum', 70, 24, 6, 100);
    const blobs = list.filter((p) => p.kind === 'blob');
    expect(blobs.map((p) => p.lifeMs)).toEqual([120, 420]);
    const embers = list.filter((p) => p.kind === 'dot');
    expect(embers.length).toBeGreaterThanOrEqual(4);
    expect(embers.length).toBeLessThanOrEqual(7);
    for (const e of embers) {
      expect(e.delayMs).toBeGreaterThanOrEqual(40);
      expect(e.delayMs).toBeLessThanOrEqual(160);
      expect(e.lifeMs).toBeGreaterThanOrEqual(380);
      expect(e.vy).toBeLessThan(0);
      expect(e.ay).toBeLessThan(0);
    }
    expect(list.every((p) => p.blend === 'add')).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(7);
    expect(list.length).toBeLessThanOrEqual(10);
  });

  it('킥 불티는 덜 올라간다(드럼의 절반)', () => {
    const v = (shape: 'drum' | 'kick') => Math.max(...runGeo(shape, 70, 70, 4, 100).filter((p) => p.kind === 'dot').map((p) => -p.vy));
    expect(v('kick')).toBeLessThan(v('drum'));
  });

  it('심벌 한 타: 가장 센 세기·판정 배율에서도 maxSpawn 이하, 수명(지연 포함)은 maxLifeMs 이하', () => {
    for (const v of [0, 60, 127]) {
      for (const mode of ['lab', 'game', 'sheet'] as const) {
        for (const j of [null, 'PERFECT', 'GOOD'] as const) {
          for (let seq = 1; seq <= 30; seq++) {
            const e: FxEvent = { seq, pad: 'CRASH', velocity: v, mode, judgement: j, deltaMs: j ? 0 : null, combo: null };
            const geo = { cx: 300, cy: 200, rx: 80, ry: 20, k: 80 / 57 };
            const list = def.spawn(e, geo, 'cymbal', fxIntensity(e), createRand(seq), def.palette('acoustic', 'cymbal', 'x'));
            expect(list.length).toBeLessThanOrEqual(def.maxSpawn);
            for (const x of list) expect(x.lifeMs + x.delayMs).toBeLessThanOrEqual(def.maxLifeMs);
          }
        }
      }
    }
  });

  it('심벌: 불똥(drop)이 식의 개수만큼 사방으로 튄다, 드럼은 위로 뜨는 dot 불티', () => {
    for (let seq = 1; seq <= 10; seq++) {
      const e: FxEvent = { seq, pad: 'CRASH', velocity: 100, mode: 'lab', judgement: null, deltaMs: null, combo: null };
      const list = runGeo('cymbal', 80, 20, seq, 100);
      const drops = list.filter((p) => p.kind === 'drop');
      expect(drops).toHaveLength(Math.min(9, Math.round(7 * fxIntensity(e).count)));
      expect(list.filter((p) => p.kind === 'dot')).toHaveLength(0);
      expect(list.filter((p) => p.kind === 'blob')).toHaveLength(2);
      expect(drops.some((p) => p.vx > 0)).toBe(true);
      expect(drops.some((p) => p.vx < 0)).toBe(true);
      // 위쪽 가장자리(시작 y가 중심보다 위)와 아래쪽 가장자리 모두에서 시작한다
      expect(drops.some((p) => p.y < 200)).toBe(true);
      expect(drops.some((p) => p.y > 200)).toBe(true);
      for (const p of drops) expect(p.delayMs + p.lifeMs).toBeLessThanOrEqual(640);
    }
    const drum = runGeo('drum', 70, 24, 6, 100);
    expect(drum.some((p) => p.kind === 'drop')).toBe(false);
    expect(drum.filter((p) => p.kind === 'dot').every((p) => p.vy < 0)).toBe(true);
  });
});
