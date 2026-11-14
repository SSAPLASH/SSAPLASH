// 타격 이펙트 엔진 — 파티클 풀·예산·시간 진행·rAF 시작/정지·통계. React와 테마 이름을 모른다(테마는 정의 조회만).
import { kitPadsFor, type KitSkin, type KitView } from '@/domain/kit/drumKit';
import { fxGeoOf } from '@/domain/hitFx/geometry';
import { fxIntensity } from '@/domain/hitFx/intensity';
import { createRand } from '@/domain/hitFx/rand';
import { JUDGE_COLORS_FALLBACK, judgeFx } from '@/domain/hitFx/judgeFx';
import { BRAND_FALLBACK, hitFxThemeDef } from '@/domain/hitFx/themes';
import { MAX_SPAWN } from '@/domain/hitFx/spawn/util';
import type { FxEvent, FxLocate, FxLocation, FxParticle, HitFxTheme, JudgeColors } from '@/domain/hitFx/types';
import { drawFrame, type FxLive, type FxView } from './fxDraw';
import { fxSheets, type FxSheetStore } from './fxSheets';

/** 전체 파티클 기본 상한(D10) */
export const MAX_PARTICLES = 200;
/** 동시에 재생하는 연속 그림(sheet) 상한. 넘으면 가장 오래된 것부터 뺀다 */
export const MAX_SHEETS = 12;
/** 한 프레임 넘김의 이펙트 시계 간격(ms) */
export const STEP_FRAME_MS = 16.7;
/** 이펙트 시계 배율 범위 */
export const MIN_TIME_SCALE = 0.1;
/** 통계 창(ms) */
const STATS_WINDOW_MS = 2000;
const FRAME_RING = 512;

export interface FxEngineOptions {
  /** 전체 파티클 상한(기본 200). 넘으면 오래된 것부터 버린다 */
  maxParticles?: number;
  /** 시계(ms). 기본 performance.now */
  now?: () => number;
  /** 프레임 예약/취소. 테스트에서 가짜로 넣는다. 기본 requestAnimationFrame */
  raf?: (cb: (ts: number) => void) => number;
  caf?: (handle: number) => void;
  /** 연속 그림 보관소. 테스트에서 가짜를 넣는다. 기본은 앱에 하나인 보관소 */
  sheets?: FxSheetStore;
}

export interface FxStats {
  /** 최근 2초 프레임 처리 시간(ms, 그리기·갱신) 평균·p95 */
  frameMsAvg: number;
  frameMsP95: number;
  /** 최근 2초 프레임 수 / 2초 → 대략의 FPS(루프가 돈 동안) */
  fps: number;
  /** 살아 있는 파티클 수 */
  alive: number;
  /** 상한을 넘어 버린 누적 수 */
  dropped: number;
  /** rAF 루프 동작 여부 */
  running: boolean;
}

export interface FxEngine {
  attach(canvas: HTMLCanvasElement | null, view: FxView): void;
  /** 크기·좌표만 다시 계산(파티클은 킷 좌표라 그대로) */
  setView(view: FxView): void;
  detach(): void;
  emit(event: FxEvent): void;
  /** 이벤트·위치·테마를 거치지 않고 만든 파티클을 바로 넣는다(결과 축하 같은 판정 밖 연출). 상한·수명 규칙은 emit과 같다 */
  spawn(particles: readonly FxParticle[]): void;
  /** 이벤트 → 위치 함수. null이면 기본(킷 좌표의 패드 위치). 하이웨이·악보는 판정 이펙트 전용 locate를 넣는다 */
  setLocate(fn: FxLocate | null): void;
  /** 판정 색(디자인 토큰을 읽은 값). 캔버스는 CSS 변수를 못 쓴다 */
  setJudgeColors(colors: JudgeColors): void;
  setTheme(id: HitFxTheme): void;
  /** view는 실물 스킨의 그림 종류(패드 자리·바닥선). 생략하면 persp */
  setSkin(skin: KitSkin, view?: KitView): void;
  setReduced(flag: boolean): void;
  /** brand 색(캔버스는 CSS 변수를 못 쓴다) */
  setBrand(color: string): void;
  /** 전체 파티클 상한을 바꾼다(랩 스파이크용). 넘치면 오래된 것부터 버린다 */
  setMaxParticles(n: number): void;
  /** 발광 스프라이트·번개 테두리 사용 여부(랩 비교용, 기본 true) */
  setGlow(flag: boolean): void;
  /** 이펙트 시계 배율 0.1~1(기본 1). 파티클의 시작 시각·나이만 느려지고 소리·판정 시각에는 영향이 없다(랩용) */
  setTimeScale(k: number): void;
  /** 이펙트 시계를 멈추거나 다시 흐르게 한다. 멈추면 마지막 그림이 그대로 남고 rAF 루프도 멈춘다(랩용) */
  setPaused(flag: boolean): void;
  /** 멈춘 상태에서 이펙트 시계를 16.7ms 앞으로 보내고 한 번 그린다. 멈춘 상태가 아니면 아무것도 안 한다(랩용) */
  stepFrame(): void;
  /** 프레임 통계·버린 수를 0으로 되돌린다(랩 측정용) */
  resetStats(): void;
  stats(): FxStats;
}

export function createFxEngine(options: FxEngineOptions = {}): FxEngine {
  let max = options.maxParticles ?? MAX_PARTICLES;
  let glow = true;
  const now = options.now ?? (() => performance.now());
  const raf = options.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = options.caf ?? ((h) => cancelAnimationFrame(h));
  const store = options.sheets ?? fxSheets;

  let theme: HitFxTheme = 'auto';
  let skin: KitSkin = 'acoustic';
  let kitView: KitView = 'persp';
  let reduced = false;
  let brand = BRAND_FALLBACK;
  let judgeColors = JUDGE_COLORS_FALLBACK;
  let locate: FxLocate | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let view: FxView | null = null;

  /** 오래된 순서로 쌓인 풀. 매 프레임 제자리에서 걸러 낸다 */
  const pool: FxLive[] = [];
  let dropped = 0;
  let handle: number | null = null;

  // 가상 시계(ms): 파티클의 시작 시각·나이는 이 시계로 잰다. 통계(frameMs·fps)는 실제 시계 그대로다
  let vt = 0;
  let lastReal = now();
  let timeScale = 1;
  let paused = false;
  /** 실제 시계가 흐른 만큼 가상 시계를 배율대로 앞으로 보낸다(멈춘 동안은 보내지 않는다) */
  function advanceClock(real: number) {
    const dt = real - lastReal;
    lastReal = real;
    if (!paused && dt > 0) vt += dt * timeScale;
  }

  // 최근 프레임 처리 시간 링 버퍼
  const frameAt = new Float64Array(FRAME_RING);
  const frameMs = new Float64Array(FRAME_RING);
  let frameHead = 0;
  let frameCount = 0;

  function schedule() {
    if (handle === null) handle = raf(tick);
  }

  /** 수명이 끝난 파티클을 걸러 내고 한 번 그린다 */
  function renderFrame() {
    // 수명이 끝난 파티클을 제자리에서 걸러 낸다(할당 없음)
    let j = 0;
    for (let i = 0; i < pool.length; i++) {
      const l = pool[i] as FxLive;
      if (vt - l.t0 < l.p.delayMs + l.p.lifeMs) pool[j++] = l;
    }
    pool.length = j;
    if (ctx && view) drawFrame(ctx, pool, vt, view, glow, store);
  }

  function tick() {
    handle = null;
    const t0 = now();
    advanceClock(t0);
    renderFrame();
    const t1 = now();
    frameAt[frameHead] = t1;
    frameMs[frameHead] = t1 - t0;
    frameHead = (frameHead + 1) % FRAME_RING;
    if (frameCount < FRAME_RING) frameCount++;
    // 멈춘 동안에는 루프를 돌리지 않는다(마지막 그림 유지)
    if (pool.length > 0 && !paused) schedule();
  }

  /** 기본 위치 찾기: 킷 좌표의 패드 헤드. 패드가 없는 킷이면 null */
  function kitLocate(event: FxEvent): FxLocation | null {
    const pad = kitPadsFor(skin, kitView).find((p) => p.pad === event.pad);
    return pad ? { geo: fxGeoOf(pad, skin, kitView), shape: pad.shape } : null;
  }

  function emit(event: FxEvent) {
    const loc = locate ? locate(event) : kitLocate(event);
    if (!loc) return;
    const def = hitFxThemeDef(theme);
    // 판정 이펙트(테마 무관)를 먼저 두고, 테마 이펙트는 패드에서 판정된·비판정 타격에만 더한다. 합쳐서 상한 = 판정 수 + 테마 maxSpawn
    const list: FxParticle[] = judgeFx(event, loc, judgeColors, reduced);
    const judgeN = list.length;
    if (loc.shape !== 'lane' && loc.shape !== 'head' && !event.stray && event.judgement !== 'MISS') {
      // 모션 줄이기는 그림 없이 덩어리만, 그림이 아직 준비되지 않았으면 입자만의 대체 함수
      const run = reduced ? def.spawnReduced : store.ready(def.sheets) ? def.spawn : def.spawnLite;
      const themed = run(event, loc.geo, loc.shape, fxIntensity(event), createRand(event.seq), def.palette(skin, loc.shape, brand));
      for (let i = 0; i < themed.length; i++) list.push(themed[i]!);
    }
    const n = Math.min(list.length, judgeN + def.maxSpawn);
    advanceClock(now());
    const t = vt;
    const themeAdditive = !reduced && def.blend === 'additive';
    for (let i = 0; i < n; i++) {
      const p = list[i]!;
      // 합성: 판정은 일반, 그림은 항상 더하기, 나머지는 파티클의 blend → 없으면 테마
      const additive = i >= judgeN && (p.kind === 'sheet' || (p.blend ? p.blend === 'add' : themeAdditive));
      pool.push({ p, t0: t, additive });
    }
    trimSheets();
    trimPool();
    if (pool.length > 0) schedule();
  }

  /** 살아 있는 sheet가 MAX_SHEETS를 넘으면 가장 오래된 sheet부터 뺀다 */
  function trimSheets() {
    let count = 0;
    for (let i = 0; i < pool.length; i++) if (pool[i]!.p.kind === 'sheet') count++;
    let over = count - MAX_SHEETS;
    if (over <= 0) return;
    let j = 0;
    for (let i = 0; i < pool.length; i++) {
      const l = pool[i] as FxLive;
      if (over > 0 && l.p.kind === 'sheet') {
        over--;
        dropped++;
      } else pool[j++] = l;
    }
    pool.length = j;
  }

  /** 전체 상한을 넘으면 오래된 것부터 버린다 */
  function trimPool() {
    const over = pool.length - max;
    if (over > 0) {
      pool.splice(0, over);
      dropped += over;
    }
  }

  function spawn(particles: readonly FxParticle[]) {
    advanceClock(now());
    const t = vt;
    const n = Math.min(particles.length, MAX_SPAWN);
    for (let i = 0; i < n; i++) pool.push({ p: particles[i]!, t0: t, additive: false });
    trimPool();
    if (pool.length > 0) schedule();
  }

  function stats(): FxStats {
    const t = now();
    const vals: number[] = [];
    let first = t;
    for (let i = 0; i < frameCount; i++) {
      const at = frameAt[i] as number;
      if (t - at > STATS_WINDOW_MS) continue;
      vals.push(frameMs[i] as number);
      if (at < first) first = at;
    }
    vals.sort((a, b) => a - b);
    const n = vals.length;
    const avg = n ? vals.reduce((s, v) => s + v, 0) / n : 0;
    const p95 = n ? (vals[Math.min(n - 1, Math.floor(n * 0.95))] as number) : 0;
    return { frameMsAvg: avg, frameMsP95: p95, fps: n / (STATS_WINDOW_MS / 1000), alive: pool.length, dropped, running: handle !== null };
  }

  const engine: FxEngine = {
    attach(c, v) {
      view = v;
      // detach로 놓았던 그림을 다시 요청한다(크기 변경 등으로 attach가 다시 불릴 때)
      store.use(engine, hitFxThemeDef(theme).sheets);
      // jsdom·happy-dom에는 2D 컨텍스트가 없다 — 없으면 아무것도 그리지 않는다
      try {
        ctx = c ? c.getContext('2d') : null;
      } catch {
        ctx = null;
      }
      if (pool.length > 0) schedule();
    },
    setView(v) {
      view = v;
    },
    detach() {
      if (handle !== null) caf(handle);
      handle = null;
      pool.length = 0;
      ctx = null;
      view = null;
      store.use(engine, []);
    },
    emit,
    spawn,
    setTheme(id) {
      theme = id;
      store.use(engine, hitFxThemeDef(id).sheets);
    },
    setSkin(s, v = 'persp') {
      skin = s;
      kitView = v;
    },
    setReduced(flag) {
      reduced = flag;
    },
    setLocate(fn) {
      locate = fn;
    },
    setJudgeColors(colors) {
      judgeColors = colors;
    },
    setBrand(color) {
      brand = color || BRAND_FALLBACK;
    },
    setMaxParticles(n) {
      max = Math.max(1, Math.floor(n));
      trimPool();
    },
    setGlow(flag) {
      glow = flag;
    },
    setTimeScale(k) {
      advanceClock(now());
      timeScale = Math.min(1, Math.max(MIN_TIME_SCALE, Number.isFinite(k) ? k : 1));
    },
    setPaused(flag) {
      if (flag === paused) return;
      // 멈추기 전에 시계를 지금까지 보내 두고, 다시 흐를 때는 멈춘 시간을 건너뛴다
      advanceClock(now());
      paused = flag;
      lastReal = now();
      if (!paused && pool.length > 0) schedule();
    },
    stepFrame() {
      if (!paused) return;
      vt += STEP_FRAME_MS;
      renderFrame();
    },
    resetStats() {
      dropped = 0;
      frameCount = 0;
      frameHead = 0;
    },
    stats,
  };
  return engine;
}
