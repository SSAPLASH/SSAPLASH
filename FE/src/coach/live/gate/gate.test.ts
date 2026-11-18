// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { describe, expect, it } from 'vitest';
import type { LiveTag } from '../rules';
import { JudgedWindow, type JudgedNote } from '../window';
import weights from './coachGate.json';
import fixture from './parity.fixture.json';
import { gateFeatures, isGatedTag } from './gate';
import { createJsonGate } from './jsonGate';
import { createOnnxGateFrom, type OrtLike } from './onnxGate';

type Row = [number, string, number | null, string, number | null, number | null];

const note = (n: Row): JudgedNote =>
  ({ songTimeMs: n[0], noteTimeMs: n[0], judgement: n[1], deltaMs: n[2], pad: n[3], stickId: n[4], velocity: n[5] }) as JudgedNote;

/** AI가 뽑은 지적 시점의 입력을 FE 창으로 다시 만든다 */
function firings() {
  return fixture.flatMap((play) => {
    const w = new JudgedWindow();
    const expected = new Map(play.fired.map((f) => [f.index, f]));
    return (play.notes as Row[]).flatMap((n, i) => {
      w.push(note(n));
      const f = expected.get(i);
      return f ? [{ tag: f.tag as LiveTag, input: gateFeatures(w.metrics(), f.tag as LiveTag), features: f.features, score: f.score }] : [];
    });
  });
}

describe('거름 입력과 점수', () => {
  it('입력이 AI 학습 때와 같다', () => {
    const list = firings();
    expect(list.length).toBeGreaterThan(30);
    for (const f of list) {
      expect(f.input).toHaveLength(weights.inputNames.length);
      f.input.forEach((v, i) => expect(v, weights.inputNames[i]).toBeCloseTo(f.features[i], 9));
    }
  });

  it('JSON 실행기 점수가 AI 계산과 같다', () => {
    const gate = createJsonGate(weights);
    for (const f of firings()) expect(gate.score(f.input) as number).toBeCloseTo(f.score, 9);
  });

  it('ONNX 실행기와 JSON 실행기의 차이가 1e-5 이하다', async () => {
    const model = new Uint8Array(readFileSync(fileURLToPath(new URL('./coachGate.onnx', import.meta.url))));
    const onnx = await createOnnxGateFrom(ort as unknown as OrtLike, model, weights.threshold);
    const json = createJsonGate(weights);
    for (const f of firings()) {
      expect(Math.abs((await onnx.score(f.input)) - (json.score(f.input) as number))).toBeLessThanOrEqual(1e-5);
    }
  });

  it('칭찬과 세팅 안내는 거르지 않는다', () => {
    expect(isGatedTag('LIVE_LATE')).toBe(true);
    expect(isGatedTag('LIVE_PAD_MISS')).toBe(true);
    expect(isGatedTag('LIVE_GOOD_KEEP')).toBe(false);
    expect(isGatedTag('LIVE_SETUP_OFFSET')).toBe(false);
  });
});
