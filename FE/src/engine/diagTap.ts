// 진단 탭. 판정(④)·채점(⑤)·출력(⑥) 관찰용 이벤트를 publish하고 모니터가 구독한다(packetTap과 같은 스타일).
// 구독자가 없으면 즉시 반환해 판정 경로에 비용을 얹지 않는다. 저장·집계는 하지 않는다(모니터 judgeLog 몫).
import type { ResolvedHit } from '@/domain/events';
import type { Judgement, TimingWindows } from '@/domain/play/judgement';
import type { CoachBasis } from '@/domain/play/coachBasis';
import type { PadId } from '@/domain/kit/pads';

/** 세션 요약(종료 시점 스냅샷). RhythmSession.snapshot()에서 필요한 값만 */
export interface DiagSessionSummary {
  score: number;
  maxScore: number;
  combo: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  /** 채보에 없는 타격 수 */
  strayHits: number;
  /** 후보 노트가 둘 이상이었던 타격 수(매칭 경합) */
  contestedHits?: number;
  judgedCount: number;
}

/** 오디오 시계 대기가 붙는 시점 */
export type ClockWaitPhase = 'begin' | 'resume' | 'restart';

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
  /** 타격 하나에 후보 노트가 둘 이상이었던 경우(매칭 경합, G4). 규칙: 기본(가장 이른 노트) / 예외(뒤 노트 PERFECT) */
  | {
      type: 'matchContested';
      hitId: number;
      songTimeMs: number;
      pad: PadId;
      candidates: number[];
      picked: number;
      rule: 'earliest' | 'perfect-exception';
    }
  /** 코칭 기준 방식별 그림자 평가(D6). 두 방식 모두 문구가 나올 때 발행한다. active는 화면에 실제로 보인 방식 */
  | { type: 'coachEval'; basis: CoachBasis; active: boolean; tag: string; tMs: number }
  | { type: 'coachGate'; runtime: 'json' | 'onnx'; tag: string; tMs: number; score: number; kept: boolean; elapsedMs: number }
  /**
   * 반주 시계 드리프트 측정(T2). 반주 재생 중 일정 주기로 발행한다. 보정은 하지 않는다.
   * audioPosMs는 오디오 시계(AudioContext) 기준 반주 재생 위치, driftMs = audioPosMs − songTimeMs.
   * 양수면 반주가 세션 곡 시각보다 앞서 있다.
   */
  | { type: 'accDrift'; songTimeMs: number; audioPosMs: number; driftMs: number }
  /**
   * 시작·재개·처음부터 전에 오디오 시계가 흐를 때까지 기다린 결과(설계 MODE-001 오디오 시계 시작 대기).
   * timedOut은 최대 대기를 넘어 그냥 시작한 경우, skipped는 컨텍스트가 없거나 running이 아니어서 기다리지 않은 경우,
   * primed는 출력이 오래 조용해 들리지 않는 신호로 장치를 먼저 깨운 경우.
   */
  | { type: 'audioClockWait'; phase: ClockWaitPhase; waitedMs: number; timedOut: boolean; skipped: boolean; primed: boolean }
  /** 곡 도중 오디오 시계가 멈췄다 흐른 흔적. jumpMs는 (화면 시계 − 오디오 시계) 차이가 커진 양. 기록만 하고 연주에는 손대지 않는다 */
  | { type: 'audioClockStall'; songTimeMs: number; jumpMs: number }
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
      /** 발 타격에 적용된 값. 따로 재지 않았으면 audioOffsetMs와 같다 */
      kickOffsetMs: number;
      /** 이 판의 타격 진동 방식(PLAY-006): judgement FE 판정 파형 / local 스틱 즉시 진동. 옛 녹화에는 없다 */
      haptic?: 'judgement' | 'local';
      noteCount: number;
      /** end일 때: 끝까지 쳤는지('finished') 중간에 나갔는지('left') */
      reason?: 'finished' | 'left';
      /** end일 때만 */
      summary?: DiagSessionSummary;
    }
  /** 곡 시작 직후: 노트 시각·pad 배열(타임라인용) */
  | { type: 'notes'; songId: string; notes: { timeMs: number; pad: PadId }[] }
  /** 곡 시작 직후(session start·notes 뒤 1회): 손별 앵커 표. hands 인덱스 0 왼손, 1 오른손. null = 그 손 보정 안 됨 */
  | { type: 'anchors'; hands: [DiagAnchor[] | null, DiagAnchor[] | null]; calibratedAt: number | null; presetId: string | null }
  /**
   * 센서 시계 오프셋(브라우저 − 센서, ms). 센서 연결 중 10초마다, 곡 시작 직후 1회.
   * offsets 인덱스 = role(0 왼손, 1 오른손, 2·3 페달). 미동기·미연결은 null
   */
  | { type: 'clock'; offsets: [number | null, number | null, number | null, number | null]; source: string }
  /**
   * 판정 타이밍 보정과 오디오 지연. 곡 시작 직후 1회 + 10초마다.
   * audioOffsetMs는 진행 중인 판의 값(없으면 설정 값). 지연은 AudioContext가 보고한 값이며 오디오를 아직 안 켰으면 null.
   * measured는 마지막 박자 맞추기 기록(없으면 null)
   */
  | {
      type: 'audio';
      audioOffsetMs: number;
      /** 발 타격에 적용된 값. 따로 재지 않았으면 audioOffsetMs와 같다 */
      kickOffsetMs: number;
      baseLatencyMs: number | null;
      outputLatencyMs: number | null;
      sampleRate: number | null;
      measured: { medianMs: number; madMs: number; pairs: number; input: 'sensor' | 'keyboard'; measuredAt: number } | null;
    }
  /** yawDriftMonitor가 SET_YAW_OFFSET을 보낸 순간. 적용 확인(PARAM_ACK 0x21)은 패킷 줄에 있다 */
  | ({ type: 'yawCorrect' } & DiagYawCorrection)
  /** 부호가 연달아 뒤집혀 그 손의 자동 보정을 멈춤. medianDeg는 보내지 않은 오차 */
  | { type: 'yawHalt'; stickId: 0 | 1; flips: number; medianDeg: number; appliedDeg: number }
  /**
   * 그 손에 최소 타격 세기(SET_PARAM 0x03)를 보낸 순간(PLAY-004 ③). dps는 보낸 값, medianDps는 보정 타격 중앙값(없으면 null),
   * samples는 계산에 쓴 표본 수. reason: capture 보정 저장 / linked 손이 붙음·설정 변경 / reset 저장값이 지워져 기본(400)으로 돌아감
   */
  | { type: 'minPeak'; stickId: 0 | 1; dps: number; medianDps: number | null; samples: number; reason: 'capture' | 'linked' | 'reset' }
  /**
   * 기기(왼손·오른손·페달) 사이 도착 지연 중앙값의 최대 차가 한도를 넘은 채 이어져 경고가 시작·끝날 때(PLAY-006).
   * medians는 기기별 도착 지연 중앙값(ms, 표본 부족이면 null), outlier는 가른 어긋난 기기(못 가르면 null)
   */
  | {
      type: 'arrivalSkew';
      phase: 'start' | 'end';
      spreadMs: number;
      medians: { left: number | null; right: number | null; pedal: number | null };
      outlier: 'left' | 'right' | 'pedal' | null;
    };

/** anchors 줄의 앵커 하나. radius는 판정에 쓰는 값(override 반영) */
export interface DiagAnchor {
  pad: PadId;
  pitch: number;
  yaw: number;
  radius: number;
  samples: number;
  spread: number;
}

/** yawCorrect 줄 본문. input/yawDriftMonitor의 YawCorrection과 구조가 같다(engine은 input을 import하지 않는다) */
export interface DiagYawCorrection {
  stickId: 0 | 1;
  /** drift 자동 드리프트 보정 / realign 재정렬(스네어 치기) / connected 연결 직후 0 초기화 */
  reason: 'drift' | 'realign' | 'connected';
  /** 보내기 전 적용값(도) */
  prevDeg: number;
  /** 보낸 절대값(도) */
  sentDeg: number;
  /** 링 중앙값 = 오차(도). realign은 요청받은 오차, connected는 null */
  medianDeg: number | null;
  /** 중앙값 절대편차(도). drift만 */
  madDeg: number | null;
  /** 그때 링의 (스틱 yaw − 앵커 yaw) 샘플. drift만 채운다 */
  samples: number[];
  /** samples와 같은 순서의 판정 주체(stick·chart·pose·key). drift만 채운다 */
  judgedBy: string[];
}

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
