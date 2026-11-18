// 채보에서 노트마다 직전 시점의 패드와 간격을 미리 계산한다. 원인 계산(cause)이 판정 한 건에서 쓸 맥락이다.
// 화면은 판정을 받을 때 notes[noteIndex]를 JudgedNote에 펼쳐 넣는다. 채보마다 한 번만 계산한다.
import type { PadId } from '@/domain/kit/pads';

/** 같은 시각으로 보는 노트 간격(ms). 킥과 하이햇처럼 동시에 치는 노트를 한 묶음으로 본다 */
const CHORD_MS = 1;

export interface NoteContext {
  /** 직전 시점(같은 시각 노트 묶음)의 패드들. 첫 묶음은 빈 배열 */
  prevPads: readonly PadId[];
  /** 직전 시점과의 간격(ms). 첫 묶음은 null */
  prevGapMs: number | null;
}

export interface ChartCoachContext {
  /** 채보 노트 순서(인덱스)와 같다 */
  notes: NoteContext[];
  /** 시점 사이 간격의 중앙값(ms). 시점이 둘 미만이면 null */
  noteGapMedianMs: number | null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** notes는 채보 노트 순서 그대로 받는다. 시각 순이 아니어도 정렬해서 계산하고 원래 순서로 돌려준다 */
export function chartCoachContext(notes: readonly { timeMs: number; pad: PadId }[]): ChartCoachContext {
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].timeMs - notes[b].timeMs);
  const groups: { timeMs: number; pads: PadId[]; members: number[] }[] = [];
  for (const i of order) {
    const n = notes[i];
    const last = groups[groups.length - 1];
    if (last && n.timeMs - last.timeMs <= CHORD_MS) {
      if (!last.pads.includes(n.pad)) last.pads.push(n.pad);
      last.members.push(i);
    } else {
      groups.push({ timeMs: n.timeMs, pads: [n.pad], members: [i] });
    }
  }

  const out: NoteContext[] = new Array(notes.length);
  const gaps: number[] = [];
  groups.forEach((g, gi) => {
    const prev = gi > 0 ? groups[gi - 1] : null;
    const gap = prev ? g.timeMs - prev.timeMs : null;
    if (gap !== null) gaps.push(gap);
    const ctx: NoteContext = { prevPads: prev ? prev.pads : [], prevGapMs: gap };
    for (const i of g.members) out[i] = ctx;
  });
  return { notes: out, noteGapMedianMs: median(gaps) };
}
