// onnxruntime-web으로 같은 모델을 계산하는 실행기. VITE_COACH_GATE=onnx 빌드에서만 불러온다.
// 결과가 비동기로 온다. 코칭 호출 쪽(LiveCoach)이 늦게 온 점수를 처리한다.
import type { CoachGate } from './gate';

interface OrtTensor {
  data: ArrayLike<number>;
}
interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}
/** 시험에서 Node용 런타임을 넣을 수 있게 필요한 부분만 적는다 */
export interface OrtLike {
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create(model: Uint8Array): Promise<OrtSession> };
}

export async function createOnnxGateFrom(ort: OrtLike, model: Uint8Array, threshold: number, version = ''): Promise<CoachGate> {
  const session = await ort.InferenceSession.create(model);
  return {
    runtime: 'onnx',
    threshold,
    model: version,
    async score(input) {
      const x = new ort.Tensor('float32', Float32Array.from(input), [1, input.length]);
      const out = await session.run({ x });
      return out.score.data[0];
    },
  };
}

export async function createOnnxGate(threshold: number, version = ''): Promise<CoachGate> {
  const [ort, wasm, mjs, modelUrl] = await Promise.all([
    import('onnxruntime-web/wasm'),
    import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url'),
    import('onnxruntime-web/ort-wasm-simd-threaded.mjs?url'),
    import('./coachGate.onnx?url&no-inline'),
  ]);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = { wasm: wasm.default, mjs: mjs.default };
  const model = new Uint8Array(await (await fetch(modelUrl.default)).arrayBuffer());
  return createOnnxGateFrom(ort as unknown as OrtLike, model, threshold, version);
}
