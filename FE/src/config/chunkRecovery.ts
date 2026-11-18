// 화면 청크 로드 실패 판별과 자동 새로고침 가드(설계 TECH-chunk-load-recovery §3-1). React를 import하지 않는다.

/** 같은 경로에서 이 시간 안에 다시 실패하면 자동 새로고침하지 않는다 */
export const RELOAD_GUARD_MS = 30000;
/** sessionStorage 가드 키. 값은 `{ path, at }` JSON */
export const RELOAD_GUARD_KEY = 'ssaplash.chunkReload';

// 브라우저별 동적 import 실패 문구(소문자 비교)
const CHUNK_MESSAGES = [
  'failed to fetch dynamically imported module', // Chrome
  'error loading dynamically imported module', // Firefox
  'importing a module script failed', // Safari
  'unable to preload css', // Vite CSS 미리 받기
];

/** 동적 import·CSS 미리 받기 실패(배포로 옛 청크가 사라진 경우 등)인지 판별한다 */
export function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { message, name } = error as { message?: unknown; name?: unknown };
  if (name === 'ChunkLoadError') return true;
  if (typeof message !== 'string') return false;
  const lower = message.toLowerCase();
  return CHUNK_MESSAGES.some((m) => lower.includes(m));
}

export type AutoReloadResult = 'reloading' | 'blocked';

export interface AutoReloadOptions {
  /** 녹음 중·저장 대기 중이면 true — 자동 새로고침하지 않는다 */
  busy: boolean;
  now?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  reload?: () => void;
}

/** 새로고침 여부를 정하고, 가능하면 기록 후 실행한다. 못 하면 'blocked'(호출 쪽이 안내를 보인다) */
export function tryAutoReload(path: string, opts: AutoReloadOptions): AutoReloadResult {
  if (opts.busy) return 'blocked';
  const now = opts.now ?? Date.now();
  const reload = opts.reload ?? (() => window.location.reload());
  try {
    const storage = opts.storage ?? window.sessionStorage;
    const raw = storage.getItem(RELOAD_GUARD_KEY);
    if (raw) {
      try {
        const prev = JSON.parse(raw) as { path?: unknown; at?: unknown } | null;
        if (prev && prev.path === path && typeof prev.at === 'number' && now - prev.at < RELOAD_GUARD_MS) return 'blocked';
      } catch {
        // 깨진 기록은 없는 것으로 본다
      }
    }
    storage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ path, at: now }));
  } catch {
    // sessionStorage를 못 쓰면 무한 새로고침을 막을 수 없으니 하지 않는다
    return 'blocked';
  }
  reload();
  return 'reloading';
}

/**
 * Vite가 화면 청크의 CSS·의존 청크 미리 받기에 실패하면 `vite:preloadError`를 보낸다.
 * 새로고침할 수 있으면 기본 throw를 막고 새로고침하고, 못 하면 그대로 두어 import가 reject되게 한다
 * (실제 화면 import 실패는 오류 경계가 받아 안내를 그린다).
 */
export function installPreloadErrorHandler(getBusy: () => boolean): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (tryAutoReload(window.location.pathname, { busy: getBusy() }) === 'reloading') event.preventDefault();
  });
}
