// audio 진단 줄 검증: 10초 주기, 곡 시작 직후 1회, 구독자 없으면 발행 안 함, 진행 중인 판의 값 우선.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagTap, type DiagEvent } from '@/engine/diagTap';
import { diagSessionEnd, diagSessionStart } from '@/engine/diagReport';
import { RhythmSession } from '@/engine/RhythmSession';
import type { Chart } from '@/domain/song/chart';
import { AUDIO_DIAG_INTERVAL_MS, startAudioDiag, type AudioDiagInfo } from './audioDiag';

const chart = { songId: 's', title: 't', bpm: 120, beatsPerBar: 4, notes: [{ timeMs: 0, pad: 'SNARE' }] } as Chart;
const windows = { perfectMs: 25, goodMs: 60 };

const info: AudioDiagInfo = {
  audioOffsetMs: -65, kickOffsetMs: -65,
  latency: { sampleRate: 48000, baseLatencyMs: 10, outputLatencyMs: 45 },
  timingCal: { measuredAt: 111, medianMs: -66.5, madMs: 9, pairs: 12, input: 'sensor', outputLatencyMs: 45, kick: null },
};

let stop: (() => void) | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stop?.();
  stop = null;
  diagSessionEnd('left');
  vi.useRealTimers();
});

const listen = () => {
  const got: DiagEvent[] = [];
  const off = diagTap.subscribe((e) => got.push(e));
  return { got, off };
};
const audioOf = (got: DiagEvent[]) => got.filter((e) => e.type === 'audio');

describe('audio 진단 줄', () => {
  it('구독자가 있으면 10초마다 판정 보정·지연·측정 기록을 낸다', () => {
    const { got, off } = listen();
    stop = startAudioDiag(() => info);
    vi.advanceTimersByTime(AUDIO_DIAG_INTERVAL_MS - 1);
    expect(got).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(got[0]).toMatchObject({
      type: 'audio',
      audioOffsetMs: -65, kickOffsetMs: -65,
      baseLatencyMs: 10,
      outputLatencyMs: 45,
      sampleRate: 48000,
      measured: { medianMs: -66.5, madMs: 9, pairs: 12, input: 'sensor', measuredAt: 111 },
    });
    vi.advanceTimersByTime(AUDIO_DIAG_INTERVAL_MS);
    expect(got).toHaveLength(2);
    off();
  });

  it('구독자가 없으면 값을 읽지 않는다', () => {
    let reads = 0;
    stop = startAudioDiag(() => {
      reads++;
      return info;
    });
    vi.advanceTimersByTime(AUDIO_DIAG_INTERVAL_MS * 3);
    expect(reads).toBe(0);
  });

  it('오디오를 안 켰고 측정 기록이 없으면 null로 낸다', () => {
    const { got, off } = listen();
    stop = startAudioDiag(() => ({ audioOffsetMs: 0, kickOffsetMs: 0, latency: null, timingCal: null }));
    vi.advanceTimersByTime(AUDIO_DIAG_INTERVAL_MS);
    expect(got[0]).toMatchObject({ audioOffsetMs: 0, baseLatencyMs: null, outputLatencyMs: null, sampleRate: null, measured: null });
    off();
  });

  it('곡 시작 직후 1회 내고, 그 판에 적용된 값을 싣는다', () => {
    const { got, off } = listen();
    stop = startAudioDiag(() => info);
    const ss = new RhythmSession(chart, { windows, countInBars: 0, audioOffsetMs: -40, kickOffsetMs: -40 });
    diagSessionStart(ss, 'RHYTHM', { windows, audioOffsetMs: -40, kickOffsetMs: -40 });
    const a = audioOf(got);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ audioOffsetMs: -40, kickOffsetMs: -40 });
    // session 줄이 먼저다
    expect(got[0].type).toBe('session');
    // 판이 끝나면 설정 값으로 돌아온다
    diagSessionEnd('finished');
    vi.advanceTimersByTime(AUDIO_DIAG_INTERVAL_MS);
    expect(audioOf(got)[1]).toMatchObject({ audioOffsetMs: -65 });
    off();
  });

  it('audio 줄의 킥 값은 판 중이면 그 판의 값, 아니면 설정 값이다', () => {
    const { got, off } = listen();
    stop = startAudioDiag(() => ({ ...info, kickOffsetMs: -30 }));
    vi.advanceTimersByTime(AUDIO_DIAG_INTERVAL_MS);
    expect(audioOf(got)[0]).toMatchObject({ audioOffsetMs: -65, kickOffsetMs: -30 });
    const ss = new RhythmSession(chart, { windows, countInBars: 0, audioOffsetMs: -50, kickOffsetMs: -20 });
    diagSessionStart(ss, 'RHYTHM', { windows, audioOffsetMs: -50, kickOffsetMs: -20 });
    expect(audioOf(got)[1]).toMatchObject({ audioOffsetMs: -50, kickOffsetMs: -20 });
    off();
  });

  it('해제하면 주기·곡 시작 모두 내지 않는다', () => {
    const { got, off } = listen();
    startAudioDiag(() => info)();
    vi.advanceTimersByTime(AUDIO_DIAG_INTERVAL_MS * 2);
    diagSessionStart(new RhythmSession(chart, { windows, countInBars: 0, audioOffsetMs: 0, kickOffsetMs: 0 }), 'RHYTHM', { windows, audioOffsetMs: 0, kickOffsetMs: 0 });
    expect(audioOf(got)).toHaveLength(0);
    off();
  });
});
