// 곡 작업실 작업 store (설계 3-6·4-1~4-3). 음원 업로드 실행, 활성 작업 보관·복원(localStorage), 곡 상태 폴링.
// jobId가 있으면 작업 스냅샷을 조회하고, 없으면 곡 상태로 복원한다.
import { create } from 'zustand';
import { ApiError } from '@/api/http';
import { getJob } from '@/api/song/jobs';
import { getSong, listAllSongs, uploadAudio } from '@/api/song/songs';
import {
  ACTIVE_JOB_KEY,
  PRECHECK_TEXT,
  UPLOAD_ERROR_TEXT,
  isRetryableUploadError,
  newIdempotencyKey,
  precheckAudio,
  songStatusToProgress,
  jobSnapshotToProgress,
  uploadErrorText,
  type ActiveJob,
  type JobProgress,
  type UploadDraft,
} from '@/domain/song/chartJob';

export type ChartJobPhase = 'idle' | 'uploading' | 'polling' | 'done' | 'failed';

/** 끝 상태를 본 경위: live는 이 화면에서 주기 조회 중, restored는 복원 뒤 첫 조회 */
export type DoneSource = 'live' | 'restored';

export interface ChartJobError {
  code: string;
  detail: string;
  retryable: boolean;
}

/** 시작 후 이 시간까지 3초, 다음 구간까지 5초, 그 뒤 15초 간격 */
const FAST_UNTIL_MS = 30_000;
const MID_UNTIL_MS = 600_000;
const FAST_INTERVAL_MS = 3_000;
const MID_INTERVAL_MS = 5_000;
const SLOW_INTERVAL_MS = 15_000;

/** 폴링 간격. 기준은 작업 시작 시각 */
export function pollIntervalMs(startedAt: string, now: number = Date.now()): number {
  const t = Date.parse(startedAt);
  const elapsed = Number.isFinite(t) ? Math.max(0, now - t) : 0;
  if (elapsed < FAST_UNTIL_MS) return FAST_INTERVAL_MS;
  if (elapsed < MID_UNTIL_MS) return MID_INTERVAL_MS;
  return SLOW_INTERVAL_MS;
}

function saveActive(job: ActiveJob): void {
  try {
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
  } catch {
    // 저장소를 못 쓰면(비공개 모드 등) 새로고침 복원만 포기한다
  }
}

function removeActive(): void {
  try {
    localStorage.removeItem(ACTIVE_JOB_KEY);
  } catch {
    // 무시
  }
}

function loadActive(): ActiveJob | null {
  try {
    const raw = localStorage.getItem(ACTIVE_JOB_KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    const ok =
      typeof v === 'object' &&
      v !== null &&
      (v.jobId === null || (typeof v.jobId === 'number' && Number.isSafeInteger(v.jobId))) &&
      typeof v.songId === 'number' &&
      Number.isSafeInteger(v.songId) &&
      typeof v.title === 'string' &&
      typeof v.idempotencyKey === 'string' &&
      typeof v.startedAt === 'string';
    if (!ok) {
      removeActive();
      return null;
    }
    return v as unknown as ActiveJob;
  } catch {
    removeActive();
    return null;
  }
}

interface ChartJobState {
  active: ActiveJob | null;
  progress: JobProgress | null;
  phase: ChartJobPhase;
  error: ChartJobError | null;
  /** 업로드 재시도용. 저장하지 않는다 */
  draft: UploadDraft | null;
  /** 완료·실패를 본 경위(설계 3-2). 끝 상태가 아니면 null */
  doneSource: DoneSource | null;

  upload: (draft: UploadDraft) => Promise<void>;
  /** 429 BUSY인데 활성 작업 기록이 없을 때: 내 곡의 PROCESSING 곡을 활성 작업으로 복원(U2 (a)) */
  recoverFromMine: () => Promise<void>;
  resume: () => void;
  retry: () => Promise<void>;
  clear: () => void;
  stopPolling: () => void;
}

const INITIAL = {
  active: null,
  progress: null,
  phase: 'idle' as ChartJobPhase,
  error: null,
  draft: null,
  doneSource: null as DoneSource | null,
};

let timer: ReturnType<typeof setTimeout> | null = null;
/** 폴링 세대. stop·재시작 후 늦게 도착한 응답을 버린다 */
let gen = 0;
/** 조회 중인 세대. 없으면 -1 */
let inflightGen = -1;
let listening = false;
/** resume·recoverFromMine 직후 첫 응답을 아직 받지 못했으면 true. 그 응답의 끝 상태는 restored로 본다 */
let restoredPending = false;
/** 현재 폴링 수명에서 반영한 작업 스냅샷의 revision */
let lastRevision: number | null = null;

const hasDocument = (): boolean => typeof document !== 'undefined';
const isHidden = (): boolean => hasDocument() && document.visibilityState === 'hidden';

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function onVisibility(): void {
  if (isHidden()) {
    clearTimer();
    return;
  }
  // 다시 보이면 즉시 1회 조회 후 재개
  clearTimer();
  if (inflightGen !== gen) void poll(gen);
}

function addListener(): void {
  if (listening || !hasDocument()) return;
  document.addEventListener('visibilitychange', onVisibility);
  listening = true;
}

function removeListener(): void {
  if (!listening) return;
  document.removeEventListener('visibilitychange', onVisibility);
  listening = false;
}

function stopLoop(): void {
  gen++;
  clearTimer();
  removeListener();
}

function schedule(my: number): void {
  clearTimer();
  if (my !== gen || isHidden()) return;
  const job = useChartJob.getState().active;
  if (!job) return;
  timer = setTimeout(() => {
    timer = null;
    void poll(my);
  }, pollIntervalMs(job.startedAt));
}

async function poll(my: number): Promise<void> {
  const job = useChartJob.getState().active;
  if (my !== gen || !job || inflightGen === my) return;
  inflightGen = my;
  try {
    let progress: JobProgress | null;
    if (job.jobId !== null) {
      const snapshot = await getJob(job.jobId);
      if (my !== gen) return;
      if (snapshot.jobId !== job.jobId || snapshot.songId !== job.songId || (lastRevision !== null && snapshot.revision <= lastRevision)) {
        schedule(my);
        return;
      }
      progress = jobSnapshotToProgress(snapshot);
      if (!progress) { schedule(my); return; }
      lastRevision = snapshot.revision;
    } else {
      const song = await getSong(job.songId);
      if (my !== gen) return;
      progress = songStatusToProgress(song.status);
    }
    const doneSource: DoneSource = restoredPending ? 'restored' : 'live';
    restoredPending = false;
    if (progress.stage === 'DONE') {
      useChartJob.setState({ progress, phase: 'done', error: null, doneSource });
      stopLoop();
      return;
    }
    if (progress.stage === 'FAILED') {
      useChartJob.setState({
        progress,
        phase: 'failed',
        error: { code: 'JOB_FAILED', detail: progress.failReason || '채보를 만들지 못했습니다.', retryable: false },
        doneSource,
      });
      stopLoop();
      return;
    }
    useChartJob.setState({ progress });
  } catch (e) {
    if (my !== gen) return;
    if (e instanceof ApiError && e.status === 404) {
      removeActive();
      useChartJob.setState({
        phase: 'failed',
        error: { code: 'AUDIO_NOT_FOUND', detail: UPLOAD_ERROR_TEXT.AUDIO_NOT_FOUND, retryable: false },
      });
      stopLoop();
      return;
    }
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      useChartJob.setState({ phase: 'failed', error: { code: 'JOB_AUTH', detail: '작업 상태를 확인할 권한이 없습니다. 다시 로그인해 주세요.', retryable: false } });
      stopLoop();
      return;
    }
    // 네트워크 등 일시 오류는 무시하고 다음 주기에 다시 조회한다(진행 표시 유지)
  } finally {
    if (inflightGen === my) inflightGen = -1;
  }
  schedule(my);
}

/** 폴링 시작. immediate면 바로 1회 조회하고, 아니면 첫 간격 뒤에 조회한다 */
function startPolling(immediate: boolean): void {
  stopLoop();
  const my = gen;
  lastRevision = null;
  addListener();
  if (immediate && !isHidden()) void poll(my);
  else schedule(my);
}

function failedUpload(code: string, detail: string | null, retryable = isRetryableUploadError(code)): void {
  useChartJob.setState({
    phase: 'failed',
    error: { code, detail: uploadErrorText(code, detail), retryable },
  });
}

export const useChartJob = create<ChartJobState>()((set, get) => {
  /** 202 이후: 활성 작업 저장·폴링 시작 */
  const accepted = (draft: UploadDraft, jobId: number, songId: number): void => {
    const active: ActiveJob = { jobId, songId, title: draft.title, idempotencyKey: draft.idempotencyKey, startedAt: new Date().toISOString() };
    saveActive(active);
    restoredPending = false;
    set({ active, progress: songStatusToProgress('QUEUED'), phase: 'polling', error: null, doneSource: null });
    startPolling(false);
  };

  const send = async (draft: UploadDraft, allowConflictRetry: boolean): Promise<void> => {
    try {
      const res = await uploadAudio(draft);
      accepted(draft, res.jobId, res.songId);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'HTTP_ERROR';
      const detail = e instanceof ApiError ? e.detail : null;
      if (code === 'AUDIO_CONFLICT' && allowConflictRetry) {
        // 같은 키에 다른 내용이라는 응답: 새 키로 한 번만 다시 보낸다
        const fresh: UploadDraft = { ...draft, idempotencyKey: newIdempotencyKey() };
        set({ draft: fresh });
        await send(fresh, false);
        return;
      }
      if (code === 'AUDIO_BUSY') {
        await get().recoverFromMine();
        return;
      }
      failedUpload(code, detail);
    }
  };

  return {
    ...INITIAL,

    upload: async (draft) => {
      if (get().phase === 'uploading' || get().phase === 'polling') return;
      stopLoop();
      removeActive();
      restoredPending = false;
      set({ ...INITIAL, draft });
      const check = precheckAudio(draft.file);
      if (!check.ok) {
        set({
          phase: 'failed',
          error: { code: `PRECHECK_${check.reason}`, detail: PRECHECK_TEXT[check.reason], retryable: false },
        });
        return;
      }
      set({ phase: 'uploading' });
      await send(draft, true);
    },

    recoverFromMine: async () => {
      try {
        // 내 곡이 한 페이지를 넘어도 PROCESSING 곡을 찾도록 전부 읽는다(Jira 363)
        const mine = await listAllSongs({ source: 'MINE' });
        const song = mine.find((s) => s.status === 'PROCESSING');
        if (song) {
          const active: ActiveJob = {
            jobId: null,
            songId: song.id,
            title: song.title,
            idempotencyKey: newIdempotencyKey(),
            startedAt: song.createdAt || new Date().toISOString(),
          };
          saveActive(active);
          restoredPending = true;
          set({ active, progress: songStatusToProgress('PROCESSING'), phase: 'polling', error: null, doneSource: null });
          startPolling(true);
          return;
        }
      } catch {
        // 목록을 못 읽으면 안내만 한다
      }
      failedUpload('AUDIO_BUSY', null, false);
    },

    resume: () => {
      const active = loadActive();
      if (!active) return;
      restoredPending = true;
      set({ active, progress: songStatusToProgress('QUEUED'), phase: 'polling', error: null, doneSource: null });
      startPolling(true);
    },

    retry: async () => {
      const { phase, error, draft } = get();
      if (phase !== 'failed' || !error?.retryable || !draft) return;
      await get().upload(draft);
    },

    clear: () => {
      stopLoop();
      restoredPending = false;
      removeActive();
      set({ ...INITIAL });
    },

    stopPolling: () => {
      stopLoop();
    },
  };
});
