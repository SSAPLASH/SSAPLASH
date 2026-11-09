// 빌드 설정(VITE_COACH_GATE, VITE_COACH_GATE_MODE)에 맞는 실행기를 불러온다.
// 꺼져 있으면 모델 파일과 런타임을 번들에서 뺀다. 불러오는 중이거나 실패하면 규칙만으로 동작한다.
import type { CoachGate, GateMode } from './gate';
import { createJsonGate, type GateWeights } from './jsonGate';

let loaded: CoachGate | null = null;
let started = false;

export function gateMode(): GateMode {
  return import.meta.env.VITE_COACH_GATE_MODE === 'on' ? 'on' : 'shadow';
}

async function load(): Promise<CoachGate | null> {
  // 조건을 빌드 상수와 직접 비교해야 꺼진 쪽의 모듈이 번들에서 빠진다
  if (import.meta.env.VITE_COACH_GATE === 'onnx') {
    const [weights, { createOnnxGate }] = await Promise.all([import('./coachGate.json'), import('./onnxGate')]);
    return createOnnxGate(weights.default.threshold, weights.default.modelVersion);
  }
  if (import.meta.env.VITE_COACH_GATE === 'json') {
    const weights = await import('./coachGate.json');
    return createJsonGate(weights.default as GateWeights);
  }
  return null;
}

/** 처음 부를 때 한 번만 불러오기 시작한다 */
export function preloadCoachGate(): void {
  if (started) return;
  started = true;
  load().then(
    (gate) => {
      loaded = gate;
    },
    () => {
      loaded = null;
    },
  );
}

export function loadedCoachGate(): CoachGate | null {
  return loaded;
}
