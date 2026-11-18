import { describe, expect, it } from 'vitest';
import { KIT_SKINS, kitPadsFor } from '@/domain/kit/drumKit';
import { fxGeoOf } from '../geometry';
import { fxIntensity } from '../intensity';
import { createRand } from '../rand';
import { SHEET_DEFS } from '../sheets';
import { hitFxThemeDef } from '../themes';
import type { FxEvent, FxMode, FxParticle } from '../types';
import { spawnWaterLite } from './waterLite';

const def = hitFxThemeDef('water');

function run(skin: (typeof KIT_SKINS)[number], pad: FxEvent['pad'], seq: number, velocity = 100, mode: FxMode = 'lab', judgement: FxEvent['judgement'] = null, view: 'persp' | 'top' = 'persp') {
  const p = kitPadsFor(skin, view).find((x) => x.pad === pad)!;
  const e: FxEvent = { seq, pad, velocity, mode, judgement, deltaMs: judgement ? 0 : null, combo: null };
  const geo = fxGeoOf(p, skin, view);
  return { geo, list: def.spawn(e, geo, p.shape, fxIntensity(e), createRand(seq), def.palette(skin, p.shape, '#35a3d4')) };
}

const sheetOf = (l: FxParticle[]) => l.find((p) => p.kind === 'sheet');

/** 킷 밖의 임의 헤드(옆에서 본 납작한 타원)로 낸다 */
function runGeo(shape: 'drum' | 'cymbal' | 'kick', rx: number, ry: number, seq: number, velocity = 100) {
  const e: FxEvent = { seq, pad: 'SNARE', velocity, mode: 'lab', judgement: null, deltaMs: null, combo: null };
  const geo = { cx: 300, cy: 200, rx, ry, k: rx / 57 };
  return def.spawn(e, geo, shape, fxIntensity(e), createRand(seq), def.palette('acoustic', shape, 'x'));
}

describe('water 테마(연속 그림 + 입자)', () => {
  it('sheet 파티클이 배열 맨 앞이고 하나뿐이다', () => {
    for (const skin of KIT_SKINS) {
      for (const p of kitPadsFor(skin)) {
        if (p.shape === 'pedal') continue;
        const { list } = run(skin, p.pad, 4);
        expect(list[0]!.kind).toBe('sheet');
        expect(list.filter((x) => x.kind === 'sheet')).toHaveLength(1);
      }
    }
  });

  it('같은 seq → 같은 파티클, 다른 seq → 다른 파티클', () => {
    expect(run('acoustic', 'SNARE', 7).list).toEqual(run('acoustic', 'SNARE', 7).list);
    expect(run('acoustic', 'SNARE', 7).list).not.toEqual(run('acoustic', 'SNARE', 8).list);
  });

  it('한 타는 maxSpawn(16) 이하, 수명(지연 포함)은 maxLifeMs(640) 이하, 값은 유한 — 모든 스킨·패드·세기·모드·판정', () => {
    for (const skin of KIT_SKINS) {
      for (const view of ['persp', 'top'] as const) {
        for (const p of kitPadsFor(skin, view)) {
          for (const v of [0, 40, 100, 127]) {
            for (const mode of ['lab', 'game', 'sheet'] as const) {
              for (const j of [null, 'PERFECT', 'GOOD'] as const) {
                const { list } = run(skin, p.pad, 13 + v, v, mode, j, view);
                expect(list.length).toBeLessThanOrEqual(def.maxSpawn);
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

  it('묶음 고르기: 실물 큰 그림의 드럼·심벌(헤드 비율 0.57~0.73)은 옆 그림, 킥과 원판 패드는 정면, 페달은 그림 없음', () => {
    expect(['water-side-a', 'water-side-b']).toContain(sheetOf(run('acoustic', 'SNARE', 1).list)!.sheet);
    expect(sheetOf(run('acoustic', 'CRASH', 1).list)!.sheet).toBe('water-cymbal');
    expect(sheetOf(run('acoustic', 'KICK', 1).list)!.sheet).toBe('water-front');
    expect(sheetOf(run('acoustic', 'HIHAT', 1).list)!.sheet).toBe('water-cymbal');
    expect(sheetOf(run('acoustic', 'HIHAT_PEDAL', 1).list)).toBeUndefined();
    for (const skin of ['electronic', 'neon'] as const) {
      for (const pad of ['SNARE', 'CRASH', 'KICK'] as const) expect(sheetOf(run(skin, pad, 1).list)!.sheet).toBe('water-front');
    }
    expect(sheetOf(run('acoustic', 'SNARE', 1, 100, 'lab', null, 'top').list)!.sheet).toBe('water-front');
  });

  it('옆에서 본 헤드(ry/rx < 0.85): 드럼은 side-a/b, 심벌은 cymbal', () => {
    expect(['water-side-a', 'water-side-b']).toContain(sheetOf(runGeo('drum', 70, 24, 1))!.sheet);
    expect(sheetOf(runGeo('cymbal', 80, 20, 1))!.sheet).toBe('water-cymbal');
  });

  it('페달은 입자만의 Lite 결과와 같다', () => {
    const p = kitPadsFor('acoustic').find((x) => x.pad === 'HIHAT_PEDAL')!;
    const e: FxEvent = { seq: 5, pad: 'HIHAT_PEDAL', velocity: 100, mode: 'lab', judgement: null, deltaMs: null, combo: null };
    const geo = fxGeoOf(p, 'acoustic');
    const pal = def.palette('acoustic', p.shape, 'x');
    expect(def.spawn(e, geo, p.shape, fxIntensity(e), createRand(5), pal)).toEqual(spawnWaterLite(e, geo, p.shape, fxIntensity(e), createRand(5), pal));
  });

  it('같은 패드를 8번 연달아 치면 그림이 두 종류 이상, 좌우 뒤집힌 것이 섞인다', () => {
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

  it('그림 필드: 헤드 중심, 크기 = span × rx × 배율(0.76 기준), 재생 길이 = 묶음 길이, 기울기 ±0.04rad', () => {
    for (let seq = 1; seq <= 20; seq++) {
      const { geo, list } = run('acoustic', 'SNARE', seq, 127);
      const s = sheetOf(list)!;
      const d = SHEET_DEFS[s.sheet!];
      expect([s.x, s.y]).toEqual([geo.cx, geo.cy]);
      expect(s.lifeMs).toBe(d.durMs);
      expect(Math.abs(s.rot!)).toBeLessThanOrEqual(0.04);
      const ratio = s.size0 / (d.span * geo.rx);
      // g=1(세기 127): 0.76 × 1.08 × (0.95~1.05)
      expect(ratio).toBeGreaterThanOrEqual(0.76 * 1.08 * 0.95 - 1e-9);
      expect(ratio).toBeLessThanOrEqual(0.76 * 1.08 * 1.05 + 1e-9);
      expect(s.alpha0).toBeCloseTo(1);
    }
  });

  it('세기가 클수록 그림이 크고 밝다(세기 40 < 120)', () => {
    const lo = sheetOf(run('acoustic', 'SNARE', 3, 40).list)!;
    const hi = sheetOf(run('acoustic', 'SNARE', 3, 120).list)!;
    expect(hi.size0).toBeGreaterThan(lo.size0);
    expect(hi.alpha0).toBeGreaterThan(lo.alpha0);
    expect(lo.alpha0).toBeGreaterThanOrEqual(0.7);
  });

  it('게임·악보 모드: 그림 ×0.72, 재생 ×1.3(수명 ÷1.3), 앞 보케 없음', () => {
    const free = run('acoustic', 'SNARE', 9, 127, 'free');
    const game = run('acoustic', 'SNARE', 9, 127, 'game');
    const sheet = run('acoustic', 'SNARE', 9, 127, 'sheet');
    const sf = sheetOf(free.list)!;
    const sg = sheetOf(game.list)!;
    // 크기 배율 외에 세기 배율(게임은 같음, 악보는 intensity ×0.7)이 다르므로 게임으로 비교한다
    expect(sg.size0 / sf.size0).toBeCloseTo(0.72, 5);
    expect(sg.lifeMs).toBeCloseTo(SHEET_DEFS[sg.sheet!].durMs / 1.3);
    expect(free.list.some((p) => p.sprite === 'bokeh')).toBe(true);
    expect(game.list.some((p) => p.sprite === 'bokeh')).toBe(false);
    expect(sheet.list.some((p) => p.sprite === 'bokeh')).toBe(false);
    expect(sheetOf(sheet.list)!.lifeMs).toBeCloseTo(SHEET_DEFS[sheetOf(sheet.list)!.sheet!].durMs / 1.3);
  });

  it('보케는 세기 80 이상, 자유 연주에서만', () => {
    expect(run('acoustic', 'SNARE', 2, 79).list.some((p) => p.sprite === 'bokeh')).toBe(false);
    expect(run('acoustic', 'SNARE', 2, 80).list.some((p) => p.sprite === 'bokeh')).toBe(true);
  });

  it('구성(드럼, 세기 100): 그림 1 + 헤드 반짝임 1 + 방울 + 잔물결 2(60·160ms 지연) + 보케', () => {
    const { list } = run('acoustic', 'SNARE', 6, 100);
    expect(list.filter((p) => p.kind === 'sheet')).toHaveLength(1);
    const glint = list.filter((p) => p.kind === 'blob');
    expect(glint).toHaveLength(1);
    expect(glint[0]).toMatchObject({ lifeMs: 110, ease: 'expo', blend: 'normal' });
    const drops = list.filter((p) => p.kind === 'drop');
    // 시안 방울의 3분의 1(세기 100에서 7개 안팎)
    expect(drops.length).toBeGreaterThanOrEqual(4);
    expect(drops.length).toBeLessThanOrEqual(7);
    const ripples = list.filter((p) => p.kind === 'ring');
    expect(ripples.map((p) => p.delayMs)).toEqual([60, 160]);
    expect(list.filter((p) => p.sprite === 'bokeh').length).toBeGreaterThanOrEqual(2);
    expect(list.length).toBeGreaterThanOrEqual(10);
    expect(list.length).toBeLessThanOrEqual(def.maxSpawn);
  });

  it('합성: 그림·방울·보케는 add, 헤드 반짝임·잔물결은 normal', () => {
    for (const pad of ['SNARE', 'CRASH', 'KICK'] as const) {
      for (const p of run('acoustic', pad, 6, 127).list) {
        if (p.kind === 'sheet' || p.kind === 'drop' || p.sprite === 'bokeh') expect(p.blend).toBe('add');
        else expect(p.blend).toBe('normal');
      }
    }
  });

  it('방울은 위로 솟는다(드럼): 처음 속도가 위쪽, 중력 아래', () => {
    const drops = run('acoustic', 'SNARE', 6, 127).list.filter((p) => p.kind === 'drop');
    expect(drops.every((p) => p.vy < 0 && p.ay > 0 && p.hold! > 0)).toBe(true);
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

  it('심벌: 보케가 없고 방울 개수가 식과 같다', () => {
    for (let seq = 1; seq <= 10; seq++) {
      const e: FxEvent = { seq, pad: 'CRASH', velocity: 127, mode: 'lab', judgement: null, deltaMs: null, combo: null };
      const list = runGeo('cymbal', 80, 20, seq, 127);
      expect(list.some((p) => p.sprite === 'bokeh')).toBe(false);
      expect(list.filter((p) => p.kind === 'drop')).toHaveLength(Math.ceil(Math.round(9 * fxIntensity(e).count) / 3));
      expect(list.filter((p) => p.kind === 'ring').at(-1)!.size1).toBe(1.16);
    }
  });
});
