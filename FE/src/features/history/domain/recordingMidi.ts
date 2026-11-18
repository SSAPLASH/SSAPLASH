// 녹음 상세 → MIDI 이벤트·바이트·파일명 (설계 REC-002 3-3~3-6, 4-2). 순수 함수라 네트워크·DOM에 접근하지 않는다.
import { writeMidiFile, type MidiEvent, type MidiFileInput } from '@/features/history/domain/midiFile';
import type { PadId } from '@/domain/kit/pads';
import type { RecordingDetail } from '@/domain/play/recording';

export const MIDI_FALLBACK_BPM = 120;
export const MIDI_FALLBACK_PPQ = 480;

/** 패드 → GM 드럼 노트 (BE 시드 스크립트의 패드별 대표 피치, 설계 3-3) */
export const PAD_GM_NOTE: Record<PadId, number> = {
  KICK: 36,
  SNARE: 38,
  HIHAT: 42,
  HIHAT_PEDAL: 44,
  SMALL_TOM: 50,
  MID_TOM: 47,
  FLOOR_TOM: 43,
  CRASH: 49,
  RIDE: 51,
};

interface Resolved {
  originMs: number;
  ppq: number;
  tempos: { tick: number; bpm: number }[];
  signatures: { tick: number; numerator: number; denominator: number }[];
  usedChartTiming: boolean;
}

const FALLBACK: Resolved = {
  originMs: 0,
  ppq: MIDI_FALLBACK_PPQ,
  tempos: [{ tick: 0, bpm: MIDI_FALLBACK_BPM }],
  signatures: [{ tick: 0, numerator: 4, denominator: 4 }],
  usedChartTiming: false,
};

const isPowerOfTwo = (n: number) => Number.isInteger(n) && n >= 1 && n <= 128 && (n & (n - 1)) === 0;

/** 템포 해석 (설계 3-4). 조건이 깨지면 대체값(120 BPM, 4/4, ppq 480, 원점 0ms) */
function resolveTiming(detail: RecordingDetail): Resolved {
  const t = detail.timing;
  if (!t) return FALLBACK;
  if (!Number.isInteger(t.ppq) || t.ppq < 1 || t.ppq > 32767 || !Number.isFinite(t.offsetMs)) return FALLBACK;

  let tempos = t.tempoMap ?? [];
  if (tempos.length === 0) {
    if (!(t.bpm > 0) || !Number.isFinite(t.bpm)) return FALLBACK;
    tempos = [{ tick: 0, bpm: t.bpm }];
  } else {
    if (tempos[0].tick !== 0) return FALLBACK;
    for (let i = 0; i < tempos.length; i++) {
      const s = tempos[i];
      if (!Number.isInteger(s.tick) || !(s.bpm > 0) || !Number.isFinite(s.bpm)) return FALLBACK;
      if (i > 0 && s.tick <= tempos[i - 1].tick) return FALLBACK;
    }
  }

  let signatures = t.timeSignatureMap ?? [];
  const signaturesOk =
    signatures.length > 0 &&
    signatures.every(
      (s, i) =>
        Number.isInteger(s.tick) &&
        s.tick >= 0 &&
        (i === 0 || s.tick > signatures[i - 1].tick) &&
        Number.isInteger(s.numerator) &&
        s.numerator >= 1 &&
        s.numerator <= 255 &&
        isPowerOfTwo(s.denominator),
    );
  // 비었거나 분모가 2의 거듭제곱이 아니면 4/4 하나로 대체(템포는 유지)
  if (!signaturesOk) signatures = [{ tick: 0, numerator: 4, denominator: 4 }];

  return {
    originMs: t.offsetMs,
    ppq: t.ppq,
    tempos: tempos.map((s) => ({ tick: s.tick, bpm: s.bpm })),
    signatures: signatures.map((s) => ({ ...s })),
    usedChartTiming: true,
  };
}

/** 원점(tick 0) 기준 ms → tick (설계 4-2). 반올림 전 실수 */
function msToTick(d: number, r: Resolved, segStartMs: number[]): number {
  const { ppq, tempos } = r;
  if (d < 0) return (d * tempos[0].bpm * ppq) / 60_000;
  let i = 0;
  while (i + 1 < tempos.length && segStartMs[i + 1] <= d) i++;
  return tempos[i].tick + ((d - segStartMs[i]) * tempos[i].bpm * ppq) / 60_000;
}

function build(detail: RecordingDetail): { input: MidiFileInput; usedChartTiming: boolean } {
  const r = resolveTiming(detail);
  const { ppq, tempos, signatures } = r;

  // 템포 구간 시작 시각(원점 기준 ms)
  const segStartMs: number[] = [];
  let acc = 0;
  for (let i = 0; i < tempos.length; i++) {
    if (i > 0) acc += ((tempos[i].tick - tempos[i - 1].tick) * 60_000) / ppq / tempos[i - 1].bpm;
    segStartMs.push(acc);
  }

  // 타격 → (노트, tick, 세기)
  const raw: { note: number; tick: number; velocity: number }[] = [];
  for (const h of detail.hits) {
    // 모르는 패드(표에 없는 값)는 노트로 옮길 수 없어 건너뛴다
    const note = PAD_GM_NOTE[h.pad] as number | undefined;
    if (!Number.isFinite(h.tMs) || note === undefined) continue;
    const v = Math.round(h.velocity);
    raw.push({
      note,
      tick: Math.round(msToTick(h.tMs - r.originMs, r, segStartMs)),
      velocity: Number.isFinite(v) ? Math.min(127, Math.max(1, v)) : 1,
    });
  }

  // 첫 박 앞 타격이 있으면 앞 마디를 덧붙인다
  const minTick = raw.reduce((m, h) => Math.min(m, h.tick), 0);
  const first = signatures[0];
  const barTicks = Math.max(1, Math.round((ppq * 4 * first.numerator) / first.denominator));
  const bars = minTick < 0 ? Math.ceil(-minTick / barTicks) : 0;
  const shift = bars * barTicks;

  const events: MidiEvent[] = [{ kind: 'trackName', tick: 0, text: 'Drums' }];
  if (bars > 0) {
    // 앞 마디 구간도 첫 템포·첫 박자표로 읽히도록 tick 0에 하나씩 둔다
    events.push({ kind: 'tempo', tick: 0, bpm: tempos[0].bpm });
    events.push({ kind: 'timeSignature', tick: 0, numerator: first.numerator, denominator: first.denominator });
  }
  for (const t of tempos) events.push({ kind: 'tempo', tick: t.tick + shift, bpm: t.bpm });
  for (const s of signatures) {
    events.push({ kind: 'timeSignature', tick: s.tick + shift, numerator: s.numerator, denominator: s.denominator });
  }

  // 노트: 같은 노트끼리 tick 순으로 보고, 길이는 기본 ppq/8, 다음 같은 노트 타격보다 1 tick 먼저 끝낸다
  const byNote = new Map<number, { tick: number; velocity: number }[]>();
  for (const h of raw) {
    const list = byNote.get(h.note) ?? [];
    list.push({ tick: h.tick + shift, velocity: h.velocity });
    byNote.set(h.note, list);
  }
  const base = Math.max(1, Math.round(ppq / 8));
  for (const [note, list] of byNote) {
    list.sort((a, b) => a.tick - b.tick);
    // 같은 tick에 같은 노트가 겹치면 하나로 합친다(세기는 큰 쪽). on/off가 뒤섞이는 걸 막기 위해서다
    const hits: { tick: number; velocity: number }[] = [];
    for (const h of list) {
      const last = hits[hits.length - 1];
      if (last && last.tick === h.tick) last.velocity = Math.max(last.velocity, h.velocity);
      else hits.push({ ...h });
    }
    hits.forEach((h, i) => {
      const gap = i + 1 < hits.length ? hits[i + 1].tick - h.tick : Infinity;
      const len = Math.max(1, Math.min(base, gap - 1));
      events.push({ kind: 'noteOn', tick: h.tick, note, velocity: h.velocity });
      events.push({ kind: 'noteOff', tick: h.tick + len, note });
    });
  }

  return { input: { ppq, events }, usedChartTiming: r.usedChartTiming };
}

/** 테스트·확인용: MIDI 이벤트 목록과 분해능 */
export function recordingMidiEvents(detail: RecordingDetail): MidiFileInput {
  return build(detail).input;
}

/** 녹음 상세 → SMF 바이트. usedChartTiming은 채보 템포·박자표를 썼는지(false면 120 BPM 4/4 대체) */
export function recordingToMidi(detail: RecordingDetail): { bytes: Uint8Array; usedChartTiming: boolean } {
  const { input, usedChartTiming } = build(detail);
  return { bytes: writeMidiFile(input), usedChartTiming };
}

const FILE_NAME_MAX = 80;
const FORBIDDEN = /[\\/:*?"<>|\p{Cc}]/gu;
const trimEdges = (s: string) => s.replace(/^[\s.]+|[\s.]+$/g, '');

/** 파일명 (설계 3-6): 금지 문자·제어 문자 제거, 앞뒤 공백·마침표 정리, 80 코드 포인트까지, `.mid`. 비면 `recording-{id}.mid` */
export function midiFileName(title: string, id: number): string {
  const cleaned = trimEdges(title.replace(FORBIDDEN, ''));
  const cut = trimEdges([...cleaned].slice(0, FILE_NAME_MAX).join(''));
  return cut === '' ? `recording-${id}.mid` : `${cut}.mid`;
}
