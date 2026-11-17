import { describe, expect, it } from 'vitest';
import { KIT_SKINS, kitPadsFor } from '@/domain/kit/drumKit';
import { fxGeoOf } from '../geometry';
import { fxIntensity } from '../intensity';
import { createRand } from '../rand';
import { SHEET_DEFS } from '../sheets';
import { hitFxThemeDef } from '../themes';
import type { FxEvent, FxMode, FxParticle } from '../types';
import { spawnElectricLite } from './electricLite';

const def = hitFxThemeDef('electric');
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

describe('electric 테마(연속 그림 + 입자)', () => {
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

  it('한 타는 maxSpawn(12) 이하, 수명(지연 포함)은 maxLifeMs(360) 이하 — 모든 스킨·패드·세기·모드·판정', () => {
    expect(def.maxSpawn).toBe(12);
    expect(def.maxLifeMs).toBe(360);
    for (const skin of KIT_SKINS) {
      for (const view of ['persp', 'top'] as const) {
        for (const p of kitPadsFor(skin, view)) {
          for (const v of [0, 40, 100, 127]) {
            for (const mode of ['lab', 'game', 'sheet'] as const) {
              for (const j of [null, 'PERFECT', 'GOOD'] as const) {
                const list = run(skin, p.pad, 31 + v, v, mode, j, view);
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
  }, 30_000); // 전수 조합이라 CI 러너에서 기본 5초를 넘는다(로컬 약 1초)

  it('묶음 고르기: 납작한 드럼은 side-a/b, 심벌은 cymbal, 원판·킥은 front, 페달은 그림 없음(Lite와 같다)', () => {
    expect(['bolt-side-a', 'bolt-side-b']).toContain(sheetOf(runGeo('drum', 70, 24, 1))!.sheet);
    expect(sheetOf(runGeo('cymbal', 80, 20, 1))!.sheet).toBe('bolt-cymbal');
    expect(sheetOf(runGeo('kick', 70, 70, 1))!.sheet).toBe('bolt-front');
    expect(sheetOf(runGeo('cymbal', 50, 50, 1))!.sheet).toBe('bolt-front');
    const e: FxEvent = { seq: 5, pad: 'HIHAT_PEDAL', velocity: 100, mode: 'lab', judgement: null, deltaMs: null, combo: null };
    const geo = { cx: 1, cy: 2, rx: 30, ry: 30, k: 0.5 };
    expect(def.spawn(e, geo, 'pedal', fxIntensity(e), createRand(5), palette)).toEqual(spawnElectricLite(e, geo, 'pedal', fxIntensity(e), createRand(5)));
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

  it('그림 필드: 길이 = 묶음 길이(360ms), 밝기 0.8~1, 세기 40 < 120이면 더 크고 밝다', () => {
    const lo = sheetOf(run('acoustic', 'SNARE', 3, 40))!;
    const hi = sheetOf(run('acoustic', 'SNARE', 3, 120))!;
    expect(hi.size0).toBeGreaterThan(lo.size0);
    expect(hi.alpha0).toBeGreaterThan(lo.alpha0);
    expect(lo.alpha0).toBeGreaterThanOrEqual(0.8);
    expect(hi.lifeMs).toBe(SHEET_DEFS[hi.sheet!].durMs);
    expect(hi.lifeMs).toBe(360);
  });

  it('게임·악보 모드: 그림 ×0.72, 재생 ×1.3', () => {
    const free = sheetOf(runGeo('kick', 70, 70, 9, 127, 'free'))!;
    const game = sheetOf(runGeo('kick', 70, 70, 9, 127, 'game'))!;
    expect(game.size0 / free.size0).toBeCloseTo(0.72, 5);
    expect(game.lifeMs).toBeCloseTo(360 / 1.3);
  });

  it('구성: 그림 1 + 흰 섬광 2(0~90ms·85~205ms) + 가장자리 불꽃 4~7(140~240ms, 절반은 85ms 지연), 전부 더하기', () => {
    const list = runGeo('drum', 70, 24, 6, 100);
    const flashes = list.filter((p) => p.kind === 'blob');
    expect(flashes.map((p) => [p.delayMs, p.lifeMs])).toEqual([[0, 90], [85, 120]]);
    const sparks = list.filter((p) => p.kind === 'drop');
    expect(sparks.length).toBeGreaterThanOrEqual(4);
    expect(sparks.length).toBeLessThanOrEqual(7);
    expect(sparks.every((p) => p.lifeMs >= 140 && p.lifeMs <= 240)).toBe(true);
    expect(sparks.filter((p) => p.delayMs === 85).length).toBe(Math.floor(sparks.length / 2));
    expect(list.every((p) => p.blend === 'add')).toBe(true);
    expect(list.some((p) => p.kind === 'bolt')).toBe(false);
    expect(list.length).toBeGreaterThanOrEqual(7);
    expect(list.length).toBeLessThanOrEqual(10);
  });

  it('가장자리 불꽃은 가장자리(헤드 반지름 0.95)에서 시작한다', () => {
    for (const p of runGeo('drum', 70, 24, 6, 100).filter((x) => x.kind === 'drop')) {
      const dx = (p.x - 300) / 70;
      const dy = (p.y - 200) / 24;
      expect(Math.hypot(dx, dy)).toBeCloseTo(0.95, 5);
    }
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

  it('심벌: 가장자리 불꽃이 드럼보다 많고 9 이하', () => {
    const drops = (shape: 'drum' | 'cymbal') => runGeo(shape, 80, 20, 6, 127).filter((p) => p.kind === 'drop').length;
    expect(drops('cymbal')).toBeGreaterThan(drops('drum'));
    expect(drops('cymbal')).toBeLessThanOrEqual(9);
    expect(runGeo('cymbal', 80, 20, 6, 127).filter((p) => p.kind === 'drop').every((p) => p.lifeMs >= 180 && p.lifeMs <= 275)).toBe(true);
  });
});
