// 녹음 재생 훅 (설계 REC-001 3-9·4-5·6-2). 행의 [재생]을 누르면 상세(타격 시퀀스)를 받아 recordingPlayer로 재생한다.
// 상세는 마지막 한 건만 기억하고, 재생 중에는 requestAnimationFrame으로 진행률(0~1)을 갱신한다. 언마운트하면 정지한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/error';
import { getRecording } from '@/api/recordings';
import type { RecordingDetail, RecordingSummary } from '@/domain/recording';
import { recordingPlayer } from '@/engine/recordingPlayer';

export interface UseRecordingPlaybackOptions {
  /** 상세 조회가 404 RECORDING_NOT_FOUND(이미 지워진 녹음)일 때 */
  onMissing?: (id: number) => void;
  /** 그 밖의 조회·재생 실패. 사용자에게 보일 문구 */
  onError?: (message: string) => void;
}

export interface UseRecordingPlayback {
  playingId: number | null;
  /** 상세를 받는 중인 행 */
  loadingId: number | null;
  /** 0~1 */
  progress: number;
  toggle: (summary: RecordingSummary) => void;
  stop: () => void;
}

export function useRecordingPlayback(options: UseRecordingPlaybackOptions = {}): UseRecordingPlayback {
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const cacheRef = useRef<RecordingDetail | null>(null);
  const loadingRef = useRef<number | null>(null);
  /** 재생을 시작한(또는 시작하려는) 행. start 이벤트가 어느 행의 것인지 알려 준다 */
  const startingRef = useRef<number | null>(null);
  const durationRef = useRef(0);
  const mountedRef = useRef(true);
  const fetchAbortRef = useRef<AbortController | null>(null);

  // 재생기 상태 알림 → playingId
  useEffect(() => {
    return recordingPlayer.onState((e) => {
      setProgress(0);
      if (e.playing) {
        setPlayingId(startingRef.current);
      } else {
        startingRef.current = null;
        setPlayingId(null);
      }
    });
  }, []);

  // 재생 중 진행률
  useEffect(() => {
    if (playingId === null) return;
    let raf = 0;
    const loop = () => {
      const d = durationRef.current;
      setProgress(d > 0 ? Math.min(1, recordingPlayer.positionMs() / d) : 0);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playingId]);

  // 언마운트: 조회 취소 + 정지
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fetchAbortRef.current?.abort();
      recordingPlayer.stop();
    };
  }, []);

  const stop = useCallback(() => recordingPlayer.stop(), []);

  const toggle = useCallback((summary: RecordingSummary) => {
    const id = summary.id;
    if (recordingPlayer.playing && startingRef.current === id) {
      recordingPlayer.stop();
      return;
    }
    if (loadingRef.current !== null) return; // 상세 로딩 중 재클릭 무시

    const start = async () => {
      let detail = cacheRef.current?.id === id ? cacheRef.current : null;
      if (!detail) {
        loadingRef.current = id;
        setLoadingId(id);
        const controller = new AbortController();
        fetchAbortRef.current = controller;
        try {
          detail = await getRecording(id, controller.signal);
          cacheRef.current = detail;
        } catch (e) {
          if (!mountedRef.current || controller.signal.aborted) return;
          if (e instanceof ApiError && e.status === 404 && e.code === 'RECORDING_NOT_FOUND') {
            optionsRef.current.onMissing?.(id);
          } else {
            optionsRef.current.onError?.(
              e instanceof ApiError && e.status > 0 && e.status < 500 ? e.detail : '녹음을 불러오지 못했어요',
            );
          }
          return;
        } finally {
          loadingRef.current = null;
          if (mountedRef.current) setLoadingId(null);
        }
      }
      if (!mountedRef.current) return;
      durationRef.current = detail.durationMs;
      startingRef.current = id;
      try {
        await recordingPlayer.play(detail.hits, {
          durationMs: detail.durationMs,
          onEnd: () => {
            startingRef.current = null;
          },
        });
      } catch {
        startingRef.current = null;
        if (mountedRef.current) optionsRef.current.onError?.('녹음을 재생하지 못했어요');
      }
    };
    void start();
  }, []);

  return { playingId, loadingId, progress, toggle, stop };
}
