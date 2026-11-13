// 채보 확인 재생 토글·실행기(T2, VITE_MONITOR 빌드 전용). lazyChartAutoplay를 통해서만 불러온다.
import { useEffect, type MutableRefObject } from 'react';
import { create } from 'zustand';
import { audioEngine } from '@/audio/AudioEngine';
import { createChartAutoplay } from './chartAutoplay';
import type { PlayClock } from '@/features/play/sessionClock';
import type { RhythmSession } from '@/engine/RhythmSession';

interface AutoplayToggleState {
  enabled: boolean;
  toggle: () => void;
}

/** 토글 상태. 영속하지 않는다(새로고침하면 꺼짐) */
const useAutoplayToggle = create<AutoplayToggleState>()((set) => ({
  enabled: false,
  toggle: () => set((s) => ({ enabled: !s.enabled })),
}));

/** 상단 바 토글 버튼 */
export function ChartAutoplayToggle() {
  const enabled = useAutoplayToggle((s) => s.enabled);
  const toggle = useAutoplayToggle((s) => s.toggle);
  return (
    <button
      className="btn-ghost small"
      aria-pressed={enabled}
      title="채보 노트를 드럼 소리로 자동 재생한다(진단용, 판정에는 영향 없음)"
      onClick={toggle}
    >
      채보 확인 재생 {enabled ? '켬' : '끔'}
    </button>
  );
}

interface RunnerProps {
  clockRef: MutableRefObject<PlayClock | null>;
  session: RhythmSession | null;
}

/** 연주 화면에 두는 보이지 않는 실행기. 켜져 있고 세션이 있으면 시계가 running인 동안만 노트를 예약한다 */
export function ChartAutoplayRunner({ clockRef, session }: RunnerProps) {
  const enabled = useAutoplayToggle((s) => s.enabled);
  useEffect(() => {
    if (!enabled || !session) return;
    const ap = createChartAutoplay({
      notes: session.chart.notes,
      songTime: () => {
        const clock = clockRef.current;
        return clock && clock.state.phase === 'running' ? clock.songTime() : null;
      },
      play: (pad, velocity, atMs) => audioEngine.triggerScheduled(pad, velocity, atMs)?.cancel,
      renderAheadMs: () => audioEngine.renderAheadMs(),
      songToContext: (songMs) => clockRef.current?.songTimeToContext(songMs) ?? null,
      contextNow: () => audioEngine.audioReading()?.ctxSec ?? null,
      playAtContext: (pad, velocity, ctxSec) => audioEngine.triggerAtContext(pad, velocity, ctxSec)?.cancel,
    });
    ap.start();
    return () => ap.stop();
  }, [enabled, session, clockRef]);
  return null;
}
