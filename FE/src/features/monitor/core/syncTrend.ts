// 추이·분포 탭의 화면 계산(순수 함수). 기울기·중앙값·스피어만 상관을 여기 두고 페이지는 표시만 한다.

/** 중앙값. 빈 배열이면 null */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 관측 오프셋의 최소제곱 기울기(ms/분). t는 ms, 값도 ms.
 * 표본이 2개 미만이거나 시각이 전부 같으면 null.
 */
export function slopeMsPerMin(samples: readonly { t: number; offsetObsMs: number }[]): number | null {
  const n = samples.length;
  if (n < 2) return null;
  // 큰 t 값에서 정밀도를 잃지 않도록 평균을 먼저 뺀다
  const mt = samples.reduce((a, s) => a + s.t, 0) / n;
  const mv = samples.reduce((a, s) => a + s.offsetObsMs, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const s of samples) {
    sxy += (s.t - mt) * (s.offsetObsMs - mv);
    sxx += (s.t - mt) ** 2;
  }
  if (sxx === 0) return null;
  return (sxy / sxx) * 60_000;
}

/** 동순위는 평균 순위(1부터) */
function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]] = avg;
    i = j + 1;
  }
  return out;
}

/** 스피어만 순위 상관(−1~1). 표본이 3개 미만이거나 한쪽이 상수면 null */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const rx = ranks(xs.slice(0, n));
  const ry = ranks(ys.slice(0, n));
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * 1초 창 POSE 유실률(%)의 이력. 추이 탭 아래 패널의 막대용이다.
 * 탭을 오가도 이어지도록 페이지가 하나 들고, 스냅샷마다 push한다(최소 1초 간격으로만 저장).
 */
export class LossHistory {
  private pts: { t: number; pct: [number | null, number | null] }[] = [];

  private readonly keep: number;

  constructor(keep = 700) {
    this.keep = keep;
  }

  push(t: number, pct: readonly [number | null, number | null]): void {
    const last = this.pts[this.pts.length - 1];
    if (last && t - last.t < 1000) return;
    this.pts.push({ t, pct: [pct[0], pct[1]] });
    if (this.pts.length > this.keep) this.pts.shift();
  }

  /** from(ms) 이후의 점. 오래된 → 최신 */
  since(from: number): readonly { t: number; pct: [number | null, number | null] }[] {
    let i = 0;
    while (i < this.pts.length && this.pts[i].t < from) i++;
    return this.pts.slice(i);
  }

  clear(): void {
    this.pts = [];
  }
}
