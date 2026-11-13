// 자유 연습 반주 재생 훅 (설계 MODE-002 3-7·4-1~4-3, D1·D4·D9·D11). 재생기 1개를 들고 고르기→재생·일시정지·탐색·끄기를 맡는다.
// 재생기·API·잠금 해제·시계는 주입할 수 있다(기본값은 실제 구현). 재생 중에만 250ms 간격으로 상태를 읽는다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSongAccompaniment, type SongAccompaniment } from '@/api/song/songs';
import { Accompaniment } from '@/audio/Accompaniment';
import { audioEngine, type AudioEngine } from '@/audio/AudioEngine';
import { unlockAudio } from '@/runtime/audioUnlock';
import {
  accompanimentBarView,
  seekTarget,
  type AccompanimentBarView,
  type AccompanimentPick,
} from '@/domain/song/freeAccompaniment';
import { ACCOMPANIMENT_NO_FILE_TEXT, accompanimentErrorText } from './accompanimentError';
import { SONGS_SOURCE } from '@/store/songStore';

/** 훅이 쓰는 재생기 부분(Accompaniment가 만족한다. 테스트에서 가짜로 바꾼다) */
export interface AccompanimentPlayerPort {
  readonly state: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';
  readonly durationMs: number;
  load(url: string, signal?: AbortSignal): Promise<void>;
  start(atPerfMs: number, fromMs?: number): void;
  pause(): number;
  stop(): void;
  unload(): void;
  positionAt(perfMs: number): number;
}

export interface FreeAccompanimentDeps {
  createPlayer?: (engine: AudioEngine) => AccompanimentPlayerPort;
  fetchAccompaniment?: (songId: number, signal?: AbortSignal) => Promise<SongAccompaniment>;
  /** 오디오 깨우기. 고르는 클릭이 사용자 동작이다 */
  unlock?: () => Promise<void>;
  /** performance.now 같은 시계(ms) */
  now?: () => number;
  /** 빌드가 반주를 쓸 수 있는지. 기본은 builtin 빌드가 아닐 때(D10) */
  available?: boolean;
}

export interface UseFreeAccompaniment {
  view: AccompanimentBarView;
  pick: (song: AccompanimentPick) => void;
  pause: () => void;
  resume: () => void;
  seek: (ms: number) => void;
  off: () => void;
  retry: () => void;
  available: boolean;
}

/** 재생 중 상태 읽기 간격(ms, D4) */
export const POLL_MS = 250;
/** 시작·재개 예약 여유(ms) */
const START_LEAD_MS = 50;

interface Snap {
  state: AccompanimentPlayerPort['state'];
  positionMs: number;
  durationMs: number;
}
const EMPTY: Snap = { state: 'idle', positionMs: 0, durationMs: 0 };

export function useFreeAccompaniment(deps: FreeAccompanimentDeps = {}): UseFreeAccompaniment {
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  const playerRef = useRef<AccompanimentPlayerPort | null>(null);
  const getPlayer = (): AccompanimentPlayerPort => {
    if (playerRef.current === null) {
      const create = depsRef.current.createPlayer ?? ((e: AudioEngine) => new Accompaniment(e));
      playerRef.current = create(audioEngine);
    }
    return playerRef.current;
  };

  const [pickState, setPickState] = useState<AccompanimentPick | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snap>(EMPTY);

  const pickRef = useRef<AccompanimentPick | null>(null);
  /** 일시정지 위치(D11). 일시정지 중 탐색도 여기만 바꾼다 */
  const pausedMsRef = useRef(0);
  /** 직전 읽기에서 재생 중이었는지. 재생 중 → ready 전환이 곡 끝이다 */
  const wasPlayingRef = useRef(false);
  /** 요청 세대. 교체·끄기·언마운트마다 올려 늦게 온 응답을 버린다 */
  const tokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const now = () => (depsRef.current.now ?? (() => performance.now()))();

  /** 재생기 상태를 읽어 화면 상태에 반영한다. 곡이 끝났으면(ready) 일시정지 위치를 0으로 */
  const sync = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      setSnap(EMPTY);
      return;
    }
    const st = player.state;
    if (st === 'playing') {
      wasPlayingRef.current = true;
      setSnap({ state: 'playing', positionMs: player.positionAt((depsRef.current.now ?? (() => performance.now()))()), durationMs: player.durationMs });
    } else if (st === 'ready' || st === 'paused') {
      // 끝난 곡(ready)은 처음에서 일시정지. 그 뒤 일시정지 중 탐색한 위치는 pausedMs가 들고 있다
      if (st === 'ready' && wasPlayingRef.current) pausedMsRef.current = 0;
      wasPlayingRef.current = false;
      setSnap({ state: 'paused', positionMs: pausedMsRef.current, durationMs: player.durationMs });
    } else {
      setSnap({ state: st, positionMs: 0, durationMs: player.durationMs });
    }
  }, []);

  const cancelInflight = () => {
    tokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const load = useCallback(
    (song: AccompanimentPick) => {
      cancelInflight();
      const token = tokenRef.current;
      const ctl = new AbortController();
      abortRef.current = ctl;
      const player = getPlayer();
      // 이전 반주는 정지 후 해제(두 곡이 겹쳐 울리지 않게)
      player.unload();
      pausedMsRef.current = 0;
      wasPlayingRef.current = false;
      pickRef.current = song;
      setPickState(song);
      setErrorText(null);
      setLoading(true);
      setSnap(EMPTY);
      const stale = () => token !== tokenRef.current;
      void (async () => {
        try {
          const fetchAcc = depsRef.current.fetchAccompaniment ?? getSongAccompaniment;
          const res = await fetchAcc(song.songId, ctl.signal);
          if (stale()) return;
          if (!res.url) {
            setErrorText(ACCOMPANIMENT_NO_FILE_TEXT);
            setLoading(false);
            return;
          }
          await (depsRef.current.unlock ?? unlockAudio)();
          if (stale()) return;
          await player.load(res.url, ctl.signal);
          if (stale()) return;
          // 불러오는 사이 화면이 숨겨졌으면 시작하지 않고 처음 위치에서 일시정지로 둔다(D9)
          if (typeof document === 'undefined' || document.visibilityState !== 'hidden') player.start(now() + START_LEAD_MS, 0);
          setLoading(false);
          sync();
        } catch (e) {
          if (stale()) return;
          player.unload();
          setErrorText(accompanimentErrorText(e));
          setLoading(false);
          setSnap(EMPTY);
        }
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sync],
  );

  const pause = useCallback(() => {
    const player = playerRef.current;
    if (!player || player.state !== 'playing') return;
    pausedMsRef.current = player.pause();
    sync();
  }, [sync]);

  const resume = useCallback(() => {
    const player = playerRef.current;
    if (!player || (player.state !== 'paused' && player.state !== 'ready')) return;
    // 일시정지 중 탐색한 위치를 쓰므로 player.resume이 아니라 start(…, 훅 위치)로 시작한다
    player.start(now() + START_LEAD_MS, pausedMsRef.current);
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  const seek = useCallback(
    (ms: number) => {
      const player = playerRef.current;
      if (!player) return;
      const target = seekTarget(ms, player.durationMs);
      if (player.state === 'playing') {
        player.start(now() + START_LEAD_MS, target);
        pausedMsRef.current = target;
      } else if (player.state === 'paused' || player.state === 'ready') {
        pausedMsRef.current = target;
      } else {
        return;
      }
      sync();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sync],
  );

  const off = useCallback(() => {
    cancelInflight();
    playerRef.current?.unload();
    pickRef.current = null;
    pausedMsRef.current = 0;
    wasPlayingRef.current = false;
    setPickState(null);
    setErrorText(null);
    setLoading(false);
    setSnap(EMPTY);
  }, []);

  const pick = useCallback((song: AccompanimentPick) => load(song), [load]);

  const retry = useCallback(() => {
    if (pickRef.current) load(pickRef.current);
  }, [load]);

  // 재생 중에만 250ms 간격으로 읽는다(D4)
  useEffect(() => {
    if (snap.state !== 'playing') return;
    const id = setInterval(sync, POLL_MS);
    return () => clearInterval(id);
  }, [snap.state, sync]);

  // 화면 숨김: 재생 중이면 일시정지하고 돌아와도 자동 재개하지 않는다(D9)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pause]);

  // 떠날 때: 조회 취소·재생기 해제(D1)
  useEffect(() => {
    return () => {
      cancelInflight();
      playerRef.current?.unload();
    };
  }, []);

  const view = useMemo(
    () =>
      accompanimentBarView({
        pick: pickState,
        playerState: snap.state,
        loading,
        positionMs: snap.positionMs,
        durationMs: snap.durationMs,
        errorText,
      }),
    [pickState, snap, loading, errorText],
  );

  const available = deps.available ?? SONGS_SOURCE !== 'builtin';

  return { view, pick, pause, resume, seek, off, retry, available };
}
