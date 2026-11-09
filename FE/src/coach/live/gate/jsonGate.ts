// 가중치를 TypeScript로 계산하는 실행기. 곱셈 몇백 번이라 동기로 끝난다.
import type { CoachGate } from './gate';

export interface GateWeights {
  mean: number[];
  scale: number[];
  w1: number[][];
  b1: number[];
  w2: number[][];
  b2: number[];
  threshold: number;
  modelVersion?: string;
}

export function createJsonGate(w: GateWeights): CoachGate {
  return {
    runtime: 'json',
    threshold: w.threshold,
    model: w.modelVersion ?? '',
    score(input) {
      const normal = input.map((v, i) => (v - w.mean[i]) / w.scale[i]);
      let logit = w.b2[0];
      for (let k = 0; k < w.b1.length; k++) {
        let hidden = w.b1[k];
        for (let i = 0; i < normal.length; i++) hidden += normal[i] * w.w1[i][k];
        if (hidden > 0) logit += hidden * w.w2[k][0];
      }
      return 1 / (1 + Math.exp(-logit));
    },
  };
}
