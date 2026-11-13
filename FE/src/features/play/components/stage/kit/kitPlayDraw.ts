// 킷 위 연주 뷰의 계산부(순수 함수). 캔버스를 모르므로 단위 테스트가 가능하다.
// 노트 위치 계산만 맡고, 그리기는 KitPlayView가 한다.
import type { PadId } from '@/domain/kit/pads';
import type { Judgement } from '@/domain/play/judgement';
import type { NoteState } from '@/engine/RhythmSession';

export interface ApproachNote {
  pad: PadId;
  index: number;
  /** 0 = 등장, 1 = 판정 시각 */
  progress: number;
  judged: Judgement | null;
  /** 판정 뒤 지난 시간(ms). 미판정이면 0 */
  ageMs: number;
}

/** 판정 직후 MISS 링이 안쪽으로 사라지는 시간 */
export const MISS_SHRINK_MS = 150;
/** 판정 시각이 지났어도 아직 칠 수 있는 노트 링을 남겨 두는 시간 (Good 창 안쪽) */
export const LATE_GRACE_MS = 120;
/** MISS는 Good 창이 끝난 뒤 판정되므로, 판정 시각을 노트 시각 + 이 값으로 추정한다 */
const MISS_DELAY_MS = 120;
/** 같은 시각으로 보는 노트 시각 차(ms) */
const SAME_TIME_MS = 1;

/**
 * 지금 그릴 접근 링 목록.
 * - 미판정 노트: 곡 시각 ~ 곡 시각 + scrollMs 사이(판정 시각이 막 지난 LATE_GRACE_MS 포함). 패드마다 가까운 maxPerPad개까지
 * - MISS 판정 노트: 판정 후 MISS_SHRINK_MS 동안(안쪽으로 줄어드는 연출용). 일반 타격은 뷰의 타격 이펙트가 맡으므로 그리지 않는다
 */
export function visibleNotes(
  notes: NoteState[],
  songTimeMs: number,
  scrollMs: number,
  maxPerPad = 4,
): ApproachNote[] {
  const out: ApproachNote[] = [];
  const perPad = new Map<PadId, number>();
  for (const n of notes) {
    const dt = n.note.timeMs - songTimeMs;
    if (dt > scrollMs) break; // 채보는 시각순
    if (n.judgement === null) {
      if (dt < -LATE_GRACE_MS) continue;
      const used = perPad.get(n.note.pad) ?? 0;
      if (used >= maxPerPad) continue;
      perPad.set(n.note.pad, used + 1);
      const progress = Math.min(1, Math.max(0, 1 - dt / scrollMs));
      out.push({ pad: n.note.pad, index: n.index, progress, judged: null, ageMs: 0 });
    } else if (n.judgement === 'MISS') {
      const ageMs = songTimeMs - (n.note.timeMs + MISS_DELAY_MS);
      if (ageMs < 0 || ageMs > MISS_SHRINK_MS) continue;
      out.push({ pad: n.note.pad, index: n.index, progress: 1, judged: 'MISS', ageMs });
    }
  }
  return out;
}

/** 곡 시각 ±toleranceMs 안에서 같은 시각에 겹친 미판정 노트의 패드 묶음. 패드가 둘 이상인 묶음만 돌려준다 */
export function chordGroups(notes: NoteState[], songTimeMs: number, toleranceMs: number): PadId[][] {
  const byTime = new Map<number, Set<PadId>>();
  for (const n of notes) {
    const dt = n.note.timeMs - songTimeMs;
    if (dt > toleranceMs) break;
    if (n.judgement !== null || dt < -toleranceMs) continue;
    const key = Math.round(n.note.timeMs / SAME_TIME_MS);
    let set = byTime.get(key);
    if (!set) byTime.set(key, (set = new Set()));
    set.add(n.note.pad);
  }
  return [...byTime.values()].filter((s) => s.size >= 2).map((s) => [...s]);
}

/** 가장 가까운 미판정 노트의 패드들(동시 노트면 모두). 판정 시각이 LATE_GRACE_MS 넘게 지난 노트는 건너뛴다 */
export function nextTargets(notes: NoteState[], songTimeMs: number): PadId[] {
  let first: NoteState | null = null;
  const pads = new Set<PadId>();
  for (const n of notes) {
    if (n.judgement !== null || n.note.timeMs - songTimeMs < -LATE_GRACE_MS) continue;
    if (!first) first = n;
    else if (n.note.timeMs - first.note.timeMs > SAME_TIME_MS) break;
    pads.add(n.note.pad);
  }
  return [...pads];
}
