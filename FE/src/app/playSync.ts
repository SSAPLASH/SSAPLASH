// 플레이 로그 서버 업로드와 리포트 미리 받기 (설계 COACH-002 D1·D2·D4·D7).
// 결과 화면은 이걸 기다리지 않는다. 상태는 로컬 로그의 upload에 저장하고, 화면은 usePlaySync로 구독한다.
// 실패해도 로그는 지우지 않고 처음 조립한 본문을 같은 playId로 다시 보낸다(같은 UUID에 다른 내용은 409).
import { create } from 'zustand';
import { ApiError } from '@/api/http';
import { uploadPlay } from '@/api/plays';
import { getAllReportNotes, getReport, getReportNotesPage, type ReportNotesDto } from '@/api/reports';
import { buildUploadBody, type PlayUploadBody } from '@/domain/playUpload';
import type { Report, ReportNote } from '@/domain/report';
import { getPlayLog, updatePlayLog, type PlayUploadState } from '@/engine/playLog';

/** 데이터 활용 동의 정책이 정해지기 전까지 false (설계 U1, BE 확인 예정) */
const CONSENT = false;
const APP_VERSION: string | null = import.meta.env.VITE_APP_VERSION || null;

interface PlaySyncStore {
  states: Record<string, PlayUploadState>;
}

/** playId → 업로드 상태. 결과 화면이 구독한다(로컬 로그 값의 거울) */
export const usePlaySync = create<PlaySyncStore>(() => ({ states: {} }));

function publish(playId: string, state: PlayUploadState): void {
  // 화면에는 본문을 싣지 않는다
  const { body: _body, ...rest } = state;
  void _body;
  usePlaySync.setState((s) => ({ states: { ...s.states, [playId]: rest } }));
}

function save(playId: string, state: PlayUploadState): void {
  updatePlayLog(playId, (l) => ({ ...l, upload: state }));
  publish(playId, state);
}

/** 같은 본문으로 다시 보내도 되는 실패인지 (업로드 명세 "오류와 재시도") */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  if (e.status === 0 || e.status === 401 || e.status === 429 || e.status >= 500) return true;
  return e.status === 409 && e.code === 'PLAY_STATE_CHANGED';
}

const inflight = new Map<string, Promise<PlayUploadState | null>>();

/**
 * 업로드를 시작한다. 이미 진행 중이면 그 Promise를 돌려준다.
 * 업로드할 수 없는 로그는 SKIPPED로 남기고, 이미 DONE이면 미리 받기만 한다.
 */
export function startPlaySync(playId: string): Promise<PlayUploadState | null> {
  const running = inflight.get(playId);
  if (running) return running;
  const p = run(playId).finally(() => inflight.delete(playId));
  inflight.set(playId, p);
  return p;
}

async function run(playId: string): Promise<PlayUploadState | null> {
  const log = getPlayLog(playId);
  if (!log) return null;
  const prev = log.upload;
  if (prev?.status === 'DONE' || prev?.status === 'SKIPPED' || (prev?.status === 'FAILED' && !prev.retryable)) {
    publish(playId, prev);
    if (prev.status === 'DONE') prefetchReport(playId);
    return prev;
  }

  let body = prev?.body as PlayUploadBody | undefined;
  if (!body) {
    const built = buildUploadBody(log, { consent: CONSENT, appVersion: APP_VERSION });
    if (!built.ok) {
      const skipped: PlayUploadState = { status: 'SKIPPED', reason: built.reason, retryable: false, attempts: 0, updatedAt: new Date().toISOString() };
      save(playId, skipped);
      return skipped;
    }
    body = built.body;
  }

  const attempts = (prev?.attempts ?? 0) + 1;
  save(playId, { status: 'UPLOADING', reason: null, retryable: false, attempts, body, updatedAt: new Date().toISOString() });
  try {
    await uploadPlay(body);
    const done: PlayUploadState = { status: 'DONE', reason: null, retryable: false, attempts, updatedAt: new Date().toISOString() };
    save(playId, done);
    prefetchReport(playId);
    return done;
  } catch (e) {
    const failed: PlayUploadState = {
      status: 'FAILED',
      reason: e instanceof ApiError ? e.code : 'UNKNOWN',
      retryable: isRetryable(e),
      attempts,
      body,
      updatedAt: new Date().toISOString(),
    };
    if (e instanceof ApiError && e.status === 400) console.warn('플레이 업로드 본문 오류', e.errors, e.detail);
    save(playId, failed);
    return failed;
  }
}

/**
 * 결과 화면 진입 시 한 번. 재시도 가능한 실패나 중단된 업로드(UPLOADING인데 진행 중이 아님), 상태가 없는 새 로그를 다시 보낸다.
 * 그 밖에는 저장된 상태만 화면에 알린다.
 */
export function resumePlaySync(playId: string): void {
  if (inflight.has(playId)) return;
  const log = getPlayLog(playId);
  if (!log) return;
  const st = log.upload;
  if (!st || st.status === 'UPLOADING' || (st.status === 'FAILED' && st.retryable) || st.status === 'DONE') {
    void startPlaySync(playId);
    return;
  }
  publish(playId, st);
}

/* ---------- 리포트 미리 받기 (D7) ---------- */

export interface ReportPrefetch {
  report: Promise<Report>;
  firstNotes: Promise<ReportNotesDto>;
}

const prefetched = new Map<string, ReportPrefetch>();

/** 요약과 노트 첫 페이지 요청을 시작해 두고, 리포트 페이지가 같은 Promise를 쓴다. 실패한 요청은 캐시에서 지운다 */
export function prefetchReport(playId: string): ReportPrefetch {
  const hit = prefetched.get(playId);
  if (hit) return hit;
  const entry: ReportPrefetch = { report: getReport(playId), firstNotes: getReportNotesPage(playId, null) };
  const drop = () => {
    if (prefetched.get(playId) === entry) prefetched.delete(playId);
  };
  entry.report.catch(drop);
  entry.firstNotes.catch(drop);
  prefetched.set(playId, entry);
  return entry;
}

/** 노트 전부(시간순). 미리 받은 첫 페이지를 이어 받는다 */
export function loadAllReportNotes(playId: string): Promise<ReportNote[]> {
  return prefetchReport(playId).firstNotes.then((first) => getAllReportNotes(playId, { first }));
}

/** 리포트 조회 오류 분류 (회신 1 §4). 화면은 ApiError를 직접 보지 않는다 */
export type ReportErrorKind = 'NO_REPORT' | 'NO_PLAY' | 'AUTH' | 'BAD_REQUEST' | 'RETRY';

export function reportErrorKind(e: unknown): ReportErrorKind {
  if (e instanceof ApiError) {
    if (e.code === 'REPORT_NOT_FOUND') return 'NO_REPORT';
    if (e.code === 'PLAY_NOT_FOUND') return 'NO_PLAY';
    if (e.status === 401) return 'AUTH';
    if (e.status === 400) return 'BAD_REQUEST';
  }
  return 'RETRY';
}

/** 테스트용 */
export function resetPlaySyncForTest(): void {
  inflight.clear();
  prefetched.clear();
  usePlaySync.setState({ states: {} });
}
