// 녹음 상태 기계 (설계 REC-001 3-4·4-1~4-3). 화면은 이 스토어를 구독하고 동작 함수만 부른다.
// 자유 연습은 녹음 중에만 inputManager.onHit를 구독하고, 게임·악보는 곡이 끝난 뒤 플레이 로그 타격에서 만든다.
import { create } from 'zustand';
import {
  MAX_RECORDING_DURATION_MS,
  MAX_RECORDING_HITS,
  buildRecordingBody,
  defaultRecordingTitle,
  hitFromFreeInput,
  hitsFromPlayLog,
  isRecordedSensor,
  normalizeRecordingTitle,
  type RecordingBody,
  type RecordingHit,
  type RecordingMode,
  type RecordingSummary,
} from '@/domain/play/recording';
import { newPlayId } from '@/engine/playLog';
import type { LoggedHit } from '@/domain/play/playLog';
import { describeRecordingError, resolvePlayId, uploadRecording, type RecordingErrorInfo } from './recordingSync';
import { inputManager } from './sources';

export type RecordingPhase = 'idle' | 'armed' | 'recording' | 'pendingSave' | 'saving' | 'failed';
export type RecordingStopReason = 'user' | 'limit' | 'leave';

/** 저장 대기 녹음. body는 첫 전송 때 고정되고 이후 재전송은 그대로 쓴다 */
export interface PendingRecording {
  mode: RecordingMode;
  defaultTitle: string;
  /** 게임·악보의 곡 제목. 자유는 null */
  songTitle: string | null;
  hits: RecordingHit[];
  hasSensor: boolean;
  startedAt: Date;
  baseDurationMs: number;
  clientKey: string;
  /** 게임·악보의 플레이 로그 playId 후보. 실제 포함 여부는 첫 전송 때 정한다 */
  playId: string | null;
  body: RecordingBody | null;
}

/** UI가 토스트로 한 번 띄우는 알림 */
export type RecordingNotice = { kind: 'noHits' } | { kind: 'saved'; recording: RecordingSummary };

/** 자유 녹음 진행 정보(경과 시간 표시용) */
export interface FreeRecordingInfo {
  startPerfMs: number;
  startedAt: Date;
  hitCount: number;
}

interface RecordingState {
  phase: RecordingPhase;
  /** 게임·악보 연주 단계 잠금 */
  locked: boolean;
  free: FreeRecordingInfo | null;
  pending: PendingRecording | null;
  stopReason: RecordingStopReason | null;
  error: RecordingErrorInfo | null;
  notice: RecordingNotice | null;
}

const INITIAL: RecordingState = { phase: 'idle', locked: false, free: null, pending: null, stopReason: null, error: null, notice: null };

export const useRecordingStore = create<RecordingState>(() => INITIAL);

const get = () => useRecordingStore.getState();
const set = (p: Partial<RecordingState>) => useRecordingStore.setState(p);

/* ---------- 자유 녹음 수집 (타격마다 상태가 바뀌지 않도록 배열은 모듈에 둔다) ---------- */

let freeHits: RecordingHit[] = [];
let freeHasSensor = false;
let freeClientKey = '';
let unsubscribeHit: (() => void) | null = null;
let limitTimer: ReturnType<typeof setTimeout> | null = null;

function stopCollecting(): void {
  unsubscribeHit?.();
  unsubscribeHit = null;
  if (limitTimer !== null) clearTimeout(limitTimer);
  limitTimer = null;
}

function inSaveWindow(phase: RecordingPhase): boolean {
  return phase === 'pendingSave' || phase === 'saving' || phase === 'failed';
}

/** 자유 녹음 시작. idle일 때만 */
export function startFree(): void {
  if (get().phase !== 'idle') return;
  const free: FreeRecordingInfo = { startPerfMs: performance.now(), startedAt: new Date(), hitCount: 0 };
  freeHits = [];
  freeHasSensor = false;
  // 녹음 키는 시작 때 정하고 재전송에도 유지한다
  freeClientKey = newPlayId();
  set({ phase: 'recording', free, pending: null, stopReason: null, error: null });
  unsubscribeHit = inputManager.onHit((hit) => {
    const cur = get().free;
    if (get().phase !== 'recording' || !cur) return;
    // 2시간을 넘긴 타격은 담지 않고 멈춘다
    if (performance.now() - cur.startPerfMs >= MAX_RECORDING_DURATION_MS) {
      stopFree('limit');
      return;
    }
    const h = hitFromFreeInput(hit, cur.startPerfMs);
    if (!h) return;
    freeHits.push(h);
    // 페달 타격은 stickId 키가 없어도 센서 타격이다(설계 D11)
    if (isRecordedSensor(hit.source)) freeHasSensor = true;
    set({ free: { ...cur, hitCount: freeHits.length } });
    if (freeHits.length >= MAX_RECORDING_HITS) stopFree('limit');
  });
  limitTimer = setTimeout(() => stopFree('limit'), MAX_RECORDING_DURATION_MS);
}

/** 자유 녹음 정지. 타격이 없으면 idle + noHits, 있으면 pendingSave */
export function stopFree(reason: RecordingStopReason): void {
  const { phase, free } = get();
  if (phase !== 'recording' || !free) return;
  stopCollecting();
  const hits = freeHits;
  const hasSensor = freeHasSensor;
  freeHits = [];
  if (hits.length === 0) {
    set({ phase: 'idle', free: null, pending: null, stopReason: null, notice: { kind: 'noHits' } });
    return;
  }
  set({
    phase: 'pendingSave',
    free: null,
    stopReason: reason,
    error: null,
    pending: {
      mode: 'FREE',
      defaultTitle: defaultRecordingTitle(null, free.startedAt),
      songTitle: null,
      hits,
      hasSensor,
      startedAt: free.startedAt,
      baseDurationMs: Math.max(0, performance.now() - free.startPerfMs),
      clientKey: freeClientKey,
      playId: null,
      body: null,
    },
  });
}

/** 게임·악보 스위치 토글. 잠겨 있거나 idle·armed가 아니면 무시 */
export function toggleArm(): void {
  const { phase, locked } = get();
  if (locked) return;
  if (phase === 'idle') set({ phase: 'armed' });
  else if (phase === 'armed') set({ phase: 'idle' });
}

export function setLocked(locked: boolean): void {
  set({ locked });
}

/** 페이지 언마운트용. armed면 idle로 돌리고 잠금을 푼다. 다른 단계는 건드리지 않는다 */
export function disarm(): void {
  set(get().phase === 'armed' ? { phase: 'idle', locked: false } : { locked: false });
}

/** 곡 종료. armed일 때만 동작한다 */
export function finishSong(args: {
  mode: 'RHYTHM' | 'SHEET';
  hits: LoggedHit[];
  chart: { title: string; durationMs: number };
  startedAt: Date;
  playId: string;
}): void {
  if (get().phase !== 'armed') return;
  const { hits, hasSensor } = hitsFromPlayLog(args.hits);
  if (hits.length === 0) {
    set({ phase: 'idle', locked: false, notice: { kind: 'noHits' } });
    return;
  }
  set({
    phase: 'pendingSave',
    locked: false,
    stopReason: null,
    error: null,
    pending: {
      mode: args.mode,
      defaultTitle: defaultRecordingTitle(args.chart.title, args.startedAt),
      songTitle: args.chart.title,
      hits,
      hasSensor,
      startedAt: args.startedAt,
      baseDurationMs: args.chart.durationMs,
      // 곡 종료 때 정한 키를 재전송에도 유지한다
      clientKey: newPlayId(),
      playId: args.playId,
      body: null,
    },
  });
}

/* ---------- 저장 ---------- */

/** 전송 한 번. 본문이 아직 없으면 playId를 정해 확정하고 pending에 고정한다(3-5) */
async function send(title: string | null): Promise<void> {
  const pending = get().pending;
  if (!pending) return;
  const key = pending.clientKey;
  // 기다리는 동안 버려졌거나 다른 녹음으로 바뀌었는지
  const stale = () => get().pending?.clientKey !== key;
  try {
    let body = pending.body;
    if (!body) {
      const playId = pending.playId ? await resolvePlayId(pending.playId) : undefined;
      if (stale()) return;
      body = buildRecordingBody({
        clientKey: pending.clientKey,
        title: normalizeRecordingTitle(title ?? '', pending.defaultTitle),
        mode: pending.mode,
        hasSensor: pending.hasSensor,
        playId,
        startedAt: pending.startedAt,
        baseDurationMs: pending.baseDurationMs,
        hits: pending.hits,
      });
      set({ pending: { ...pending, body } });
    }
    const saved = await uploadRecording(body);
    if (stale()) return;
    set({ phase: 'idle', pending: null, error: null, stopReason: null, notice: { kind: 'saved', recording: saved } });
  } catch (e) {
    if (stale()) return;
    set({ phase: 'failed', error: describeRecordingError(e) });
  }
}

/** 저장 창 [저장]. pendingSave일 때만. 빈 제목은 기본 제목 */
export async function save(title: string): Promise<void> {
  if (get().phase !== 'pendingSave') return;
  set({ phase: 'saving', error: null });
  await send(title);
}

/** [다시 시도]. failed이고 재시도 가능할 때만, 확정 본문 그대로 다시 보낸다 */
export async function retry(): Promise<void> {
  const { phase, error } = get();
  if (phase !== 'failed' || !error?.retryable) return;
  set({ phase: 'saving', error: null });
  await send(null);
}

/** 저장 창 어느 단계에서든 버리고 idle로 */
export function discard(): void {
  if (!inSaveWindow(get().phase)) return;
  set({ phase: 'idle', pending: null, error: null, stopReason: null });
}

/** 알림을 한 번 꺼내고 비운다 */
export function consumeNotice(): RecordingNotice | null {
  const n = get().notice;
  if (n) set({ notice: null });
  return n;
}

/** 테스트용 */
export function resetRecordingForTest(): void {
  stopCollecting();
  freeHits = [];
  freeHasSensor = false;
  freeClientKey = '';
  useRecordingStore.setState(INITIAL);
}
