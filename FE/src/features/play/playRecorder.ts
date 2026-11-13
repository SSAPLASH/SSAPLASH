// 연주 중 타격·판정 기록기. 활성 타격과 MISS 판정에 처리 순서대로 순번을 매긴다(업로드 hits.seq).
// 서버는 seq 순서로 maxCombo를 다시 계산하므로, 타격과 MISS가 실제로 처리된 순서를 잃으면 안 된다.
import { isFootHit, type ResolvedHit } from '@/domain/events';
import type { JudgementEvent, RhythmSession } from '@/engine/RhythmSession';
import { toLoggedHit } from '@/engine/playLog';
import type { LoggedHit } from '@/domain/play/playLog';

export class PlayRecorder {
  hits: LoggedHit[] = [];
  private misses = new Map<number, number>();
  private next = 0;

  /** 새 연주(시작·처음부터) */
  reset(): void {
    this.hits = [];
    this.misses = new Map();
    this.next = 0;
  }

  /**
   * 활성 타격 하나. handleHit 직후 호출한다 — PERFECT·GOOD 판정 이벤트는 handleHit 안에서 먼저 나가지만
   * 순번은 여기서 받으므로 MISS와 섞이지 않는다
   */
  hit(hit: ResolvedHit, ev: JudgementEvent | null, ss: RhythmSession): LoggedHit {
    const lh = toLoggedHit(hit);
    lh.seq = this.next++;
    lh.tSongMs = ss.hitSongTimeMs(hit.tHit, isFootHit(hit));
    if (ev) {
      lh.judgement = ev.judgement;
      lh.matchedNoteIndex = ev.noteIndex;
      lh.deltaMs = ev.deltaMs ?? undefined;
    }
    this.hits.push(lh);
    return lh;
  }

  /** 세션 판정 이벤트. MISS만 여기서 순번을 받는다(PERFECT·GOOD은 hit()에서) */
  judgement(e: JudgementEvent): void {
    if (e.judgement === 'MISS') this.misses.set(e.noteIndex, this.next++);
  }

  /** noteIndex → MISS 순번 */
  get missSeqs(): ReadonlyMap<number, number> {
    return this.misses;
  }
}
