// 진단 탭. 판정(④)·채점(⑤)·출력(⑥) 관찰용 이벤트를 publish하고 모니터가 구독한다(packetTap과 같은 스타일).
// 구독자가 없으면 즉시 반환해 판정 경로에 비용을 얹지 않는다. 저장·집계는 하지 않는다(모니터 judgeLog 몫).
import type { ResolvedHit } from '@/domain/events';
import type { Judgement, TimingWindows } from '@/domain/judgement';
import type { PadId } from '@/domain/pads';

/** 세션 요약(종료 시점 스냅샷). RhythmSession.snapshot()에서 필요한 값만 */
export interface DiagSessionSummary {
  score: number;
  maxScore: number;
  combo: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  /** 채보에 없는 타격 수 */
  strayHits: number;
  judgedCount: number;
}

/** 이벤트 본문. 시각 t는 publish가 performance.now()로 붙인다 */
export type DiagBody =
  /** bootstrap의 inputManager.onHit 끝. tAudio는 연주 화면의 리스너가 나중에 채울 수 있어 hit 참조를 그대로 싣는다 */
  | { type: 'resolved'; hit: ResolvedHit }
  /** 연주 중 타격 하나의 채점 결과. judgement가 null이면 채보 밖 타격(stray) */
  | {
      type: 'judged';
      hitId: number;
      judgement: Judgement | null;
      noteIndex: number | null;
      /** 매칭된 노트의 pad. stray면 null */
      notePad: PadId | null;
      /** 타격의 최종 pad(패드 없음이면 null) */
      hitPad: PadId | null;
      deltaMs: number | null;
      songTimeMs: number;
    }
  /** 연결된 타격 없이 시간 초과로 MISS가 된 노트 */
  | { type: 'missed'; noteIndex: number; pad: PadId; songTimeMs: number }
  | {
      type: 'session';
      phase: 'start' | 'pause' | 'resume' | 'end';
      mode: 'RHYTHM' | 'SHEET';
      songId: string;
      title: string;
      chartVersionId: number | null;
      windows: TimingWindows;
      audioOffsetMs: number;
      noteCount: number;
      /** end일 때: 끝까지 쳤는지('finished') 중간에 나갔는지('left') */
      reason?: 'finished' | 'left';
      /** end일 때만 */
      summary?: DiagSessionSummary;
    }
  /** 곡 시작 직후: 노트 시각·pad 배열(타임라인용) */
  | { type: 'notes'; songId: string; notes: { timeMs: number; pad: PadId }[] };

export type DiagEvent = DiagBody & { /** performance.now() */ t: number };

export type DiagListener = (ev: DiagEvent) => void;

/** judgementToDiag가 읽는 세션의 부분. RhythmSession이 구조적으로 만족한다 */
export interface DiagSessionLike {
  notes: readonly { hitId: number | null }[];
  songTime(now?: number): number;
}

/**
 * RhythmSession.onJudgement 이벤트에서 missed를 파생한다(설계 R5).
 * MISS이면서 그 노트에 연결된 타격(hitId)이 없을 때만 missed. 나머지 판정은 judged가 따로 싣는다.
 * RhythmSession을 바꾸지 않으므로, 판정 로직이 바뀌면 이 규칙과 테스트를 함께 본다.
 */
export function judgementToDiag(
  session: DiagSessionLike,
  e: { judgement: Judgement; noteIndex: number; pad: PadId; at: number },
): DiagBody | null {
  if (e.judgement !== 'MISS') return null;
  if (session.notes[e.noteIndex]?.hitId !== null) return null;
  return { type: 'missed', noteIndex: e.noteIndex, pad: e.pad, songTimeMs: session.songTime(e.at) };
}

class DiagTap {
  private listeners = new Set<DiagListener>();

  /** 구독자가 있는지. 호출자가 이벤트 본문 준비 비용을 아낄 때 쓴다 */
  get active(): boolean {
    return this.listeners.size > 0;
  }

  publish(body: DiagBody): void {
    if (this.listeners.size === 0) return;
    const ev = { ...body, t: performance.now() } as DiagEvent;
    for (const l of this.listeners) l(ev);
  }

  subscribe(fn: DiagListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const diagTap = new DiagTap();
