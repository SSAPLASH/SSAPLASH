// 녹음 재생 훅 (설계 REC-001 3-9·4-5·6-2). 행의 [재생]을 누르면 상세(타격 시퀀스)를 받아 recordingPlayer로 재생한다.
// 상세는 마지막 한 건만 기억하고, 재생 중에는 requestAnimationFrame으로 위치(ms)를 갱신한다. 언마운트하면 정지한다.
// 재생 중인 행의 버튼은 정지가 아니라 일시정지·이어 재생이고, 재생바로 위치를 옮길 수 있다(338 녹음 재생바).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/error';
import { getRecording } from '@/api/play/recordings';
import type { RecordingDetail, RecordingSummary } from '@/domain/play/recording';
import { recordingPlayer } from './recordingPlayer';

export interface UseRecordingPlaybackOptions {
  /** 상세 조회가 404 RECORDING_NOT_FOUND(이미 지워진 녹음)일 때 */
  onMissing?: (id: number) => void;
  /** 그 밖의 조회·재생 실패. 사용자에게 보일 문구 */
  onError?: (message: string) => void;
}

export interface UseRecordingPlayback {
  /** 재생 대상 행(재생 중이거나 일시정지). 끝까지 재생하거나 정지하면 null */
  playingId: number | null;
  /** 재생 대상이 일시정지 상태다 */
  paused: boolean;
  /** 재생을 준비하는 중인 행(상세 조회부터 소리가 시작될 때까지) */
  loadingId: number | null;
  /** 재생 위치(ms) */
  positionMs: number;
  /** 재생 대상 행이면 일시정지 ↔ 이어 재생, 다른 행이면 그 행을 처음부터 재생 */
  toggle: (summary: RecordingSummary) => void;
  /** 재생 대상의 위치를 옮긴다(재생바) */
  seek: (ms: number) => void;
  stop: () => void;
}

export function useRecordingPlayback(options: UseRecordingPlaybackOptions = {}): UseRecordingPlayback {
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [positionMs, setPositionMs] = useState(0);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const cacheRef = useRef<RecordingDetail | null>(null);
  const loadingRef = useRef<number | null>(null);
  /** 재생을 시작한(또는 시작하려는) 행. start 이벤트가 어느 행의 것인지 알려 준다 */
  const startingRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const fetchAbortRef = useRef<AbortController | null>(null);

  // 재생기 상태 알림 → playingId·paused
  useEffect(() => {
    return recordingPlayer.onState((e) => {
      if (e.reason === 'pause') {
        setPaused(true);
        setPositionMs(recordingPlayer.positionMs());
        return;
      }
      setPaused(false);
      if (e.reason === 'resume') return;
      setPositionMs(0);
      if (e.playing) {
        setPlayingId(startingRef.current);
      } else {
        startingRef.current = null;
        setPlayingId(null);
      }
    });
  }, []);

  // 재생 중 위치. 일시정지 동안은 붙잡은 위치 그대로라 돌리지 않는다
  useEffect(() => {
    if (playingId === null || paused) return;
    let raf = 0;
    const loop = () => {
      setPositionMs(recordingPlayer.positionMs());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playingId, paused]);

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

  const seek = useCallback((ms: number) => {
    recordingPlayer.seek(ms);
    // 일시정지 중에는 위치를 읽는 루프가 없으므로 바로 반영한다
    setPositionMs(recordingPlayer.positionMs());
  }, []);

  const toggle = useCallback((summary: RecordingSummary) => {
    const id = summary.id;
    if (recordingPlayer.active && startingRef.current === id) {
      if (recordingPlayer.paused) {
        recordingPlayer.resume().catch(() => {
          if (mountedRef.current) optionsRef.current.onError?.('녹음을 재생하지 못했어요');
        });
      } else {
        recordingPlayer.pause();
      }
      return;
    }
    if (loadingRef.current !== null) return; // 재생을 준비하는 중(상세 조회·오디오 준비) 재클릭 무시

    // 준비 중 표시는 상세 조회부터 소리가 실제로 시작될 때(오디오 준비 포함)까지 한 번에 이어진다.
    // 조회가 끝난 뒤 오디오를 기다리는 사이에 표시를 풀면 행이 쉬는 모양으로 잠깐 되돌아가 깜빡이고, 그 틈에 다시 누르면 재생이 두 번 시작된다
    const start = async () => {
      loadingRef.current = id;
      setLoadingId(id);
      try {
        let detail = cacheRef.current?.id === id ? cacheRef.current : null;
        if (!detail) {
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
          }
        }
        if (!mountedRef.current) return;
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
      } finally {
        loadingRef.current = null;
        if (mountedRef.current) setLoadingId(null);
      }
    };
    void start();
  }, []);

  return { playingId, paused, loadingId, positionMs, toggle, seek, stop };
}
