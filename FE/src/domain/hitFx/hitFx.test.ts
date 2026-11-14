import { describe, expect, it } from 'vitest';
import { DRUM_KIT_H, DRUM_KIT_W, KIT_SKINS, kitPadsFor } from '@/domain/kit/drumKit';
import { fxGeoOf } from './geometry';
import { fxIntensity } from './intensity';
import { BOLT_SUB, createSample, jagPath, sampleParticle } from './motion';
import { createRand, rand01 } from './rand';
import { HIT_FX_LAB_THEMES, HIT_FX_THEMES, HIT_FX_THEME_LABELS, hitFxThemeDef, isHitFxTheme } from './themes';
import { MAX_SPAWN, particle } from './spawn/util';
import type { FxEvent, FxParticle } from './types';

const ev = (seq: number, pad: FxEvent['pad'], velocity = 100): FxEvent => ({ seq, pad, velocity, mode: 'lab', judgement: null, deltaMs: null, combo: null });

function spawnAll(theme: (typeof HIT_FX_LAB_THEMES)[number], seq: number, velocity: number, reduced = false, lite = false) {
  const def = hitFxThemeDef(theme);
  const out: { skin: string; pad: string; list: FxParticle[] }[] = [];
  for (const skin of KIT_SKINS) {
    for (const p of kitPadsFor(skin)) {
      const e = ev(seq, p.pad, velocity);
      const run = reduced ? def.spawnReduced : lite ? def.spawnLite : def.spawn;
      out.push({ skin, pad: p.pad, list: run(e, fxGeoOf(p, skin), p.shape, fxIntensity(e), createRand(seq), def.palette(skin, p.shape, '#35a3d4')) });
    }
  }
  return out;
}

describe('rand', () => {
  it('같은 입력은 같은 값, 0~1 범위', () => {
    expect(rand01(7, 3)).toBe(rand01(7, 3));
    const r = createRand(9);
    const r2 = createRand(9);
    for (let i = 0; i < 20; i++) {
      const v = r();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('fxIntensity', () => {
  it('범위: size 0.6~1.4, count 0.5~1.5, alpha 0.6~1', () => {
    const lo = fxIntensity(ev(1, 'SNARE', 0));
    const hi = fxIntensity(ev(1, 'SNARE', 127));
    expect(lo).toEqual({ size: 0.6, count: 0.5, alpha: 0.6 });
    expect(hi.size).toBeCloseTo(1.4);
    expect(hi.count).toBeCloseTo(1.5);
    expect(hi.alpha).toBeCloseTo(1);
  });
  it('감마 0.8: 중간 세기는 선형보다 높다', () => {
    const v = 63.5 / 127;
    expect(fxIntensity(ev(1, 'SNARE', 63.5)).size).toBeCloseTo(0.6 + 0.8 * Math.pow(v, 0.8));
    expect(fxIntensity(ev(1, 'SNARE', 63.5)).size).toBeGreaterThan(1.0);
  });
  it('범위 밖 세기는 자르고 판정 null이면 배율 1(같은 값)', () => {
    expect(fxIntensity(ev(1, 'SNARE', 500))).toEqual(fxIntensity(ev(1, 'SNARE', 127)));
    expect(fxIntensity(ev(1, 'SNARE', -5))).toEqual(fxIntensity(ev(1, 'SNARE', 0)));
  });
  it('세기가 클수록 단조 증가', () => {
    expect(fxIntensity(ev(1, 'SNARE', 120)).size).toBeGreaterThan(fxIntensity(ev(1, 'SNARE', 40)).size);
  });
});

describe('fxGeoOf', () => {
  it('전자 킥 중심은 패드 중심(390,215)', () => {
    const kick = kitPadsFor('electronic').find((p) => p.pad === 'KICK')!;
    const g = fxGeoOf(kick, 'electronic');
    expect(g.cx).toBeCloseTo(390);
    expect(g.cy).toBeCloseTo(215);
    expect(g.rx).toBeCloseTo(72 * (156 / 160));
  });
  it('실물 스네어는 타원(rx > ry)', () => {
    const sn = kitPadsFor('acoustic').find((p) => p.pad === 'SNARE')!;
    const g = fxGeoOf(sn, 'acoustic');
    expect(g.rx).toBeGreaterThan(g.ry);
  });
});

describe('테마 목록', () => {
  it('출시 목록·이름·검사', () => {
    expect(HIT_FX_THEMES).toEqual(['auto', 'electric', 'water', 'fire']);
    expect(HIT_FX_LAB_THEMES).toEqual(['auto', 'electric', 'water', 'fire', 'ink', 'pixel']);
    for (const t of HIT_FX_THEMES) expect(HIT_FX_LAB_THEMES).toContain(t);
    for (const t of HIT_FX_LAB_THEMES) {
      expect(HIT_FX_THEME_LABELS[t]).toBeTruthy();
      expect(isHitFxTheme(t)).toBe(true);
    }
    expect(isHitFxTheme('plasma')).toBe(false);
    expect(isHitFxTheme(3)).toBe(false);
  });
});

describe('테마 정의 · 연속 그림·상한·여백', () => {
  it('그림 묶음은 물·불·전기 각 4개, 나머지는 빈 목록', () => {
    expect(hitFxThemeDef('water').sheets).toEqual(['water-side-a', 'water-side-b', 'water-cymbal', 'water-front']);
    expect(hitFxThemeDef('fire').sheets).toEqual(['fire-side-a', 'fire-side-b', 'fire-cymbal', 'fire-front']);
    expect(hitFxThemeDef('electric').sheets).toEqual(['bolt-side-a', 'bolt-side-b', 'bolt-cymbal', 'bolt-front']);
    for (const t of ['auto', 'ink', 'pixel'] as const) expect(hitFxThemeDef(t).sheets).toEqual([]);
  });
  it('maxSpawn·bleedTop', () => {
    const v = (t: (typeof HIT_FX_LAB_THEMES)[number]) => [hitFxThemeDef(t).maxSpawn, hitFxThemeDef(t).bleedTop];
    expect(v('water')).toEqual([16, 0.4]);
    expect(v('fire')).toEqual([12, 0.35]);
    expect(v('electric')).toEqual([12, 0.35]);
    for (const t of ['auto', 'ink', 'pixel'] as const) expect(v(t)).toEqual([24, 0.12]);
  });
  it('그림 없는 테마의 spawnLite는 spawn과 같다, 테마 라벨은 그대로', () => {
    for (const t of ['auto', 'ink', 'pixel'] as const) expect(hitFxThemeDef(t).spawnLite).toBe(hitFxThemeDef(t).spawn);
    expect(HIT_FX_THEMES.map((t) => HIT_FX_THEME_LABELS[t])).toEqual(['기본', '전기', '물', '불']);
  });
});

describe.each(HIT_FX_LAB_THEMES)('spawn %s', (theme) => {
  const def = hitFxThemeDef(theme);
  it('같은 seq → 같은 결과, 다른 seq → 다른 결과', () => {
    expect(spawnAll(theme, 5, 100)).toEqual(spawnAll(theme, 5, 100));
    if (theme !== 'auto') expect(spawnAll(theme, 5, 100)).not.toEqual(spawnAll(theme, 6, 100));
  });
  it('모든 스킨·패드·세기에서 한 타격 상한 24 이하, 비어 있지 않음', () => {
    for (const v of [0, 40, 100, 127]) {
      for (const r of spawnAll(theme, 11, v)) {
        expect(r.list.length).toBeGreaterThan(0);
        expect(r.list.length).toBeLessThanOrEqual(MAX_SPAWN);
      }
    }
  });
  it('수명(시작 지연 포함)은 테마의 maxLifeMs 이하(물·불 640, 전기 360, 잉크 600, 나머지 450), 좌표·시간은 유한', () => {
    expect(def.maxLifeMs).toBe({ auto: 450, electric: 360, water: 640, fire: 640, ink: 600, pixel: 450 }[theme]);
    for (const r of [...spawnAll(theme, 3, 127), ...spawnAll(theme, 4, 10)]) {
      for (const p of r.list) {
        expect(p.lifeMs + p.delayMs).toBeLessThanOrEqual(def.maxLifeMs);
        expect(p.lifeMs).toBeGreaterThan(0);
        for (const n of [p.x, p.y, p.vx, p.vy, p.size0, p.size1, p.alpha0, p.alpha1]) expect(Number.isFinite(n)).toBe(true);
      }
    }
  });
  it('모션 줄이기: 움직임 없는 덩어리 1개', () => {
    for (const r of spawnAll(theme, 3, 100, true)) {
      expect(r.list).toHaveLength(1);
      const p = r.list[0]!;
      expect(p.kind).toBe('blob');
      expect([p.vx, p.vy, p.ax, p.ay]).toEqual([0, 0, 0, 0]);
      expect(p.lifeMs).toBeLessThanOrEqual(450);
    }
  });
  it('드럼·심벌·킥의 모양이 서로 다르다', () => {
    const by = (pad: string) => JSON.stringify(spawnAll(theme, 8, 100).find((r) => r.skin === 'electronic' && r.pad === pad)?.list.map((p) => [p.kind, p.size0, p.size1, p.rx > 0]));
    const set = new Set([by('SNARE'), by('CRASH'), by('KICK')]);
    // auto는 설계상 드럼·킥이 같은 링이라 심벌만 달라진다
    expect(set.size).toBe(theme === 'auto' ? 2 : 3);
  });
});

describe('auto 테마(옛 HitEffects 재현)', () => {
  const def = hitFxThemeDef('auto');
  it('스네어: 링 1개 450ms, 스파크 없음', () => {
    const r = spawnAll('auto', 1, 100).find((x) => x.skin === 'acoustic' && x.pad === 'SNARE')!;
    expect(r.list.map((p) => p.kind)).toEqual(['ring']);
    expect(r.list[0]!.lifeMs).toBe(450);
  });
  it('심벌: 링 + 스파크 8개(350ms), 모든 스킨', () => {
    for (const r of spawnAll('auto', 1, 100).filter((x) => x.pad === 'CRASH')) {
      expect(r.list.filter((p) => p.kind === 'ring')).toHaveLength(1);
      const sparks = r.list.filter((p) => p.kind === 'dot');
      expect(sparks).toHaveLength(8);
      expect(sparks.every((p) => p.lifeMs === 350)).toBe(true);
    }
  });
  it('링 중심은 패드 위치, 세기가 클수록 더 퍼지고 진하다', () => {
    const kick = kitPadsFor('electronic').find((p) => p.pad === 'KICK')!;
    const g = fxGeoOf(kick, 'electronic');
    const mk = (v: number) => {
      const e = ev(1, 'KICK', v);
      return def.spawn(e, g, 'kick', fxIntensity(e), createRand(1), def.palette('electronic', 'kick', '#35a3d4'))[0]!;
    };
    expect(mk(100).x).toBeCloseTo(390);
    expect(mk(100).y).toBeCloseTo(215);
    expect(mk(120).size1).toBeGreaterThan(mk(40).size1);
    expect(mk(120).alpha0).toBeGreaterThan(mk(40).alpha0);
  });
  it('색: 실물·전자는 brand, 네온은 모양별 색', () => {
    expect(def.palette('acoustic', 'drum', '#abcdef').main).toBe('#abcdef');
    expect(def.palette('neon', 'drum', '#abcdef').main).toBe('#22e4ff');
    expect(def.palette('neon', 'kick', '#abcdef').main).toBe('#ff3ec8');
    expect(def.palette('electronic', 'cymbal', 'x').sub).toBe('#FFFFFF');
    expect(def.palette('acoustic', 'cymbal', 'x').sub).toBe('#FBE7A6');
  });
});

describe('electric(입자만의 대체 함수 spawnLite)', () => {
  it('드럼은 번개 3~5줄 + 섬광, 번개는 점 목록과 씨앗이 있다', () => {
    for (const v of [0, 60, 127]) {
      const r = spawnAll('electric', 2, v, false, true).find((x) => x.skin === 'neon' && x.pad === 'SNARE')!;
      const bolts = r.list.filter((p) => p.kind === 'bolt');
      expect(bolts.length).toBeGreaterThanOrEqual(3);
      expect(bolts.length).toBeLessThanOrEqual(5);
      expect(r.list.some((p) => p.kind === 'blob' && p.glow)).toBe(true);
      for (const b of bolts) {
        expect(b.points!.length).toBeGreaterThanOrEqual(4);
        expect(b.seed).toBeDefined();
      }
    }
  });
  it('킥 방전은 킷 아래쪽 가로선(y 일정)', () => {
    const r = spawnAll('electric', 2, 100, false, true).find((x) => x.skin === 'electronic' && x.pad === 'KICK')!;
    const b = r.list.find((p) => p.kind === 'bolt')!;
    const ys = b.points!.filter((_, i) => i % 2 === 1);
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toBeGreaterThan(215);
    expect(ys[0]).toBeLessThanOrEqual(DRUM_KIT_H + 4);
  });
  it('가산 합성', () => {
    expect(hitFxThemeDef('electric').blend).toBe('additive');
    expect(hitFxThemeDef('water').blend).toBe('normal');
  });
});

describe('water(입자만의 대체 함수 spawnLite)', () => {
  it('드럼: 파문 2~3겹(지연) + 중력 물방울', () => {
    const r = spawnAll('water', 2, 100, false, true).find((x) => x.skin === 'neon' && x.pad === 'SNARE')!;
    const rings = r.list.filter((p) => p.kind === 'ring');
    expect(rings.length).toBeGreaterThanOrEqual(2);
    expect(rings.length).toBeLessThanOrEqual(3);
    expect(rings.map((p) => p.delayMs)).toEqual([...rings.map((p) => p.delayMs)].sort((a, b) => a - b));
    expect(rings[1]!.delayMs).toBeGreaterThan(0);
    const drops = r.list.filter((p) => p.kind === 'dot');
    expect(drops.length).toBeGreaterThan(0);
    expect(drops.every((p) => p.ay > 0 && p.vy < 0)).toBe(true);
  });
});

describe('sampleParticle', () => {
  const p = particle({ kind: 'dot', x: 10, y: 20, vx: 100, vy: 0, ay: 1000, size0: 4, size1: 2, alpha0: 1, alpha1: 0, color: '#fff', lifeMs: 400, ease: 'linear' });
  it('수명 밖이면 false, 안이면 선형 보간·운동식', () => {
    const s = createSample();
    expect(sampleParticle(p, -1, s)).toBe(false);
    expect(sampleParticle(p, 400, s)).toBe(false);
    expect(sampleParticle(p, 200, s)).toBe(true);
    expect(s.x).toBeCloseTo(10 + 100 * 0.2);
    expect(s.y).toBeCloseTo(20 + 0.5 * 1000 * 0.04);
    expect(s.size).toBeCloseTo(3);
    expect(s.alpha).toBeCloseTo(0.5);
  });
  it('step12는 약 83ms 계단으로 움직인다', () => {
    const q = { ...p, ease: 'step12' as const, ay: 0 };
    const a = createSample();
    const b = createSample();
    sampleParticle(q, 90, a);
    sampleParticle(q, 160, b);
    expect(a.x).toBe(b.x);
  });
  it('expo: 처음에 빠르게 올라 1에 가까워진다', () => {
    const q = particle({ kind: 'dot', x: 0, y: 0, size0: 0, size1: 1, alpha0: 0, alpha1: 1, color: '#fff', lifeMs: 100, ease: 'expo' });
    const s = createSample();
    sampleParticle(q, 10, s);
    expect(s.size).toBeCloseTo(1 - Math.pow(2, -1));
    sampleParticle(q, 90, s);
    expect(s.size).toBeGreaterThan(0.99);
  });
  it('순간 속도 = 위치 식의 미분(감속·가속 포함)', () => {
    const q = particle({ kind: 'drop', x: 0, y: 0, vx: 100, vy: -200, ax: 10, ay: 500, drag: 3, color: '#fff', lifeMs: 800, ease: 'linear' });
    const a = createSample();
    const b = createSample();
    sampleParticle(q, 200, a);
    sampleParticle(q, 201, b);
    expect(a.vx).toBeCloseTo((b.x - a.x) / 0.001, 0);
    expect(a.vy).toBeCloseTo((b.y - a.y) / 0.001, 0);
    const nodrag = particle({ kind: 'drop', x: 0, y: 0, vx: 50, ay: 1000, color: '#fff', lifeMs: 800 });
    sampleParticle(nodrag, 100, a);
    expect(a.vx).toBe(50);
    expect(a.vy).toBeCloseTo(100);
  });
  it('hold: 수명의 hold 비율까지 alpha0 유지, 그 뒤 alpha1로', () => {
    const q = particle({ kind: 'dot', x: 0, y: 0, alpha0: 0.8, alpha1: 0, color: '#fff', lifeMs: 100, hold: 0.5, ease: 'linear' });
    const s = createSample();
    sampleParticle(q, 40, s);
    expect(s.alpha).toBeCloseTo(0.8);
    sampleParticle(q, 75, s);
    expect(s.alpha).toBeCloseTo(0.8 * (1 - 0.25));
    sampleParticle(q, 99.9, s);
    expect(s.alpha).toBeLessThan(0.01);
  });
  it('번개 꺾임 단계는 40ms마다 오른다', () => {
    const s = createSample();
    sampleParticle(p, 39, s);
    expect(s.step).toBe(0);
    sampleParticle(p, 41, s);
    expect(s.step).toBe(1);
  });
});

describe('jagPath', () => {
  const base = [0, 0, 100, 0];
  it('양 끝 고정, 같은 씨앗·단계는 같은 모양, 단계가 다르면 달라진다', () => {
    const a = new Float64Array(128);
    const b = new Float64Array(128);
    const n = jagPath(base, 5, 1, 10, a);
    expect(n).toBe(BOLT_SUB + 1);
    expect([a[0], a[1], a[(n - 1) * 2], a[(n - 1) * 2 + 1]]).toEqual([0, 0, 100, 0]);
    jagPath(base, 5, 1, 10, b);
    expect(Array.from(a.slice(0, n * 2))).toEqual(Array.from(b.slice(0, n * 2)));
    jagPath(base, 5, 2, 10, b);
    expect(Array.from(a.slice(0, n * 2))).not.toEqual(Array.from(b.slice(0, n * 2)));
  });
  it('꺾임 폭은 amp 이내', () => {
    const a = new Float64Array(128);
    const n = jagPath(base, 1, 0, 6, a);
    for (let i = 0; i < n; i++) expect(Math.abs(a[i * 2 + 1]!)).toBeLessThanOrEqual(6);
  });
  it('킷 좌표 상수가 유효', () => {
    expect(DRUM_KIT_W).toBe(760);
  });
});

describe('fire(입자만의 대체 함수 spawnLite)', () => {
  it('가산 합성, 드럼: 불꽃(덩어리)+위로 솟는 불씨, 심벌: 사방 불티, 킥: 아래에서 치솟는 불길', () => {
    expect(hitFxThemeDef('fire').blend).toBe('additive');
    const get = (pad: string) => spawnAll('fire', 2, 100, false, true).find((x) => x.skin === 'electronic' && x.pad === pad)!.list;
    const drum = get('SNARE');
    expect(drum.some((p) => p.kind === 'blob' && p.vy < 0)).toBe(true);
    expect(drum.filter((p) => p.kind === 'dot').every((p) => p.vy < 0)).toBe(true);
    const cym = get('CRASH');
    expect(cym.every((p) => p.kind === 'dot')).toBe(true);
    expect(cym.some((p) => p.vy > 0)).toBe(true);
    expect(cym.some((p) => p.vy < 0)).toBe(true);
    const kick = get('KICK');
    const flames = kick.filter((p) => p.kind === 'blob');
    expect(flames.length).toBeGreaterThanOrEqual(3);
    // 킥 불길은 패드 중심보다 아래에서 시작해 위로 간다
    expect(flames.every((p) => p.y > 215 && p.vy < 0)).toBe(true);
  });
});

describe('ink', () => {
  it('일반 합성, 수명 상한 600ms, 밝은 잉크색', () => {
    const def = hitFxThemeDef('ink');
    expect(def.blend).toBe('normal');
    expect(def.maxLifeMs).toBe(600);
    expect(def.palette('neon', 'drum', 'x').main).toMatch(/^#[89a-f]/i);
  });
  it('드럼은 덩어리가 번지고(size 증가), 심벌은 가는 직선 먹선, 킥은 큰 자국', () => {
    const get = (pad: string) => spawnAll('ink', 2, 100).find((x) => x.skin === 'electronic' && x.pad === pad)!.list;
    expect(get('SNARE').every((p) => p.kind === 'blob' && p.size1 > p.size0)).toBe(true);
    const lines = get('CRASH').filter((p) => p.kind === 'bolt');
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines.every((p) => p.jag === 0 && p.points!.length === 4 && p.w0 < 2.5)).toBe(true);
    const kick = get('KICK');
    const big = Math.max(...kick.map((p) => p.rx));
    expect(big).toBeGreaterThan(Math.max(...get('SNARE').map((p) => p.rx)));
  });
});

describe('pixel', () => {
  it('모든 파티클이 사각 픽셀이고 12fps 계단 움직임', () => {
    expect(hitFxThemeDef('pixel').blend).toBe('normal');
    for (const r of spawnAll('pixel', 2, 100)) {
      expect(r.list.every((p) => p.kind === 'pixel' && p.ease === 'step12')).toBe(true);
    }
  });
  it('킥 고리 블록이 드럼 파편보다 크다', () => {
    const get = (pad: string) => spawnAll('pixel', 2, 100).find((x) => x.skin === 'electronic' && x.pad === pad)!.list;
    expect(Math.min(...get('KICK').map((p) => p.size0))).toBeGreaterThan(Math.max(...get('CRASH').map((p) => p.size0)));
  });
});

describe('fxGeoOf · 위에서 본 그림(view)', () => {
  it('바닥선(floor)이 view의 킷 상자 높이를 따른다', () => {
    const snTop = kitPadsFor('acoustic', 'top').find((p) => p.pad === 'SNARE')!;
    const snPersp = kitPadsFor('acoustic').find((p) => p.pad === 'SNARE')!;
    expect(fxGeoOf(snTop, 'acoustic', 'top').floor).toBeCloseTo(650.7);
    expect(fxGeoOf(snPersp, 'acoustic').floor).toBeCloseTo(486.9);
  });

  it('헤드 중심·반지름은 위에서 본 그림의 패드 자리에서 온다', () => {
    const sn = kitPadsFor('acoustic', 'top').find((p) => p.pad === 'SNARE')!;
    const g = fxGeoOf(sn, 'acoustic', 'top');
    const s = sn.w / 160;
    expect(g.cx).toBeCloseTo(sn.left + sn.art!.head.cx * s);
    expect(g.cy).toBeCloseTo(sn.top + sn.art!.head.cy * s);
    expect(g.rx).toBeCloseTo(sn.art!.head.rx * s);
  });

  it('전자·네온은 view를 줘도 같다(floor 없음)', () => {
    const kick = kitPadsFor('electronic', 'top').find((p) => p.pad === 'KICK')!;
    expect(fxGeoOf(kick, 'electronic', 'top')).toEqual(fxGeoOf(kick, 'electronic'));
  });
});
