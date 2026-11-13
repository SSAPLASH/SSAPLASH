// pushMinPeak 검증(PLAY-004 ③): 같은 값 생략·force·저장값 없음 → 400·진단 줄 이유.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noteMinPeakCapture, pushMinPeak } from './sensorSession';
import { inputManager } from './sources';
import { BaseInputSource } from '@/input/source/InputSource';
import { diagTap, type DiagEvent } from '@/engine/diagTap';
import { useSettings } from '@/store/settingsStore';
import type { InputSourceKind, StickId } from '@/domain/events';

class MockSource extends BaseInputSource {
  readonly kind = 'ble' as InputSourceKind;
  readonly label = 'mock';
  sent: { bytes: number[]; stickId?: StickId }[] = [];
  sendCommand(bytes: Uint8Array, stickId?: StickId): void {
    this.sent.push({ bytes: [...bytes], stickId });
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

let src: MockSource;
let lines: DiagEvent[];
let off: () => void;
const minPeakLines = () => lines.filter((l) => l.type === 'minPeak');

beforeEach(async () => {
  src = new MockSource();
  await inputManager.attach(src);
  lines = [];
  off = diagTap.subscribe((e) => lines.push(e));
  useSettings.setState({ stickMinPeak: [null, null] });
  // 모듈 안 마지막 전송 기억을 비우려고 force로 한 번씩 보낸 뒤 기록을 지운다
  pushMinPeak(0, { force: true });
  pushMinPeak(1, { force: true });
  src.sent = [];
  lines = [];
});

afterEach(async () => {
  off();
  await inputManager.detach('ble');
  useSettings.setState({ stickMinPeak: [null, null] });
});

describe('pushMinPeak', () => {
  it('저장값이 없으면 기본 400을 보내고(null → 400), 마지막에 보낸 값과 같으면 생략한다', () => {
    pushMinPeak(0);
    expect(src.sent).toEqual([]);
    useSettings.setState({ stickMinPeak: [320, null] });
    pushMinPeak(0);
    expect(src.sent).toEqual([{ bytes: [0x14, 0x03, 0x40, 0x01], stickId: 0 }]);
    pushMinPeak(0);
    expect(src.sent).toHaveLength(1);
    // 값이 지워져 400으로 돌아가면 다시 보내고 이유는 reset
    useSettings.setState({ stickMinPeak: [null, null] });
    pushMinPeak(0);
    expect(src.sent[1]).toEqual({ bytes: [0x14, 0x03, 0x90, 0x01], stickId: 0 });
    expect(minPeakLines().at(-1)).toMatchObject({ type: 'minPeak', stickId: 0, dps: 400, medianDps: null, samples: 0, reason: 'reset' });
  });

  it('force면 같은 값이어도 보내고 이유를 그대로 싣는다. 손별로 따로 기억한다', () => {
    pushMinPeak(1, { force: true, reason: 'linked' });
    pushMinPeak(1, { force: true, reason: 'linked' });
    expect(src.sent.map((s) => s.stickId)).toEqual([1, 1]);
    expect(minPeakLines().map((l) => (l as { reason: string }).reason)).toEqual(['linked', 'linked']);
    useSettings.setState({ stickMinPeak: [300, null] });
    pushMinPeak(0);
    expect(src.sent.at(-1)).toMatchObject({ stickId: 0 });
    pushMinPeak(1);
    expect(src.sent).toHaveLength(3);
  });

  it('noteMinPeakCapture로 적어 둔 근거는 다음 전송의 진단 줄(capture)에 실리고 한 번만 쓴다', () => {
    noteMinPeakCapture(0, 800, 14);
    useSettings.setState({ stickMinPeak: [320, null] });
    pushMinPeak(0);
    expect(minPeakLines()[0]).toMatchObject({ stickId: 0, dps: 320, medianDps: 800, samples: 14, reason: 'capture' });
    pushMinPeak(0, { force: true });
    expect(minPeakLines()[1]).toMatchObject({ medianDps: null, samples: 0, reason: 'linked' });
  });

  it('명시한 reason·medianDps·samples가 우선한다', () => {
    useSettings.setState({ stickMinPeak: [null, 280] });
    pushMinPeak(1, { reason: 'capture', medianDps: 700, samples: 8 });
    expect(minPeakLines()[0]).toMatchObject({ dps: 280, medianDps: 700, samples: 8, reason: 'capture' });
  });
});
