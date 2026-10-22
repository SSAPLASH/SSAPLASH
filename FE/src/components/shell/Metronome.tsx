// 상단 바 메트로놈 칩 + 팝오버. 자기 완결 — 상태는 liveStore.metronome, 조작은 engine 싱글턴 메서드만 쓴다.
import { useEffect, useRef, useState } from 'react';
import { BEATS_PER_BAR_OPTIONS, BPM_MAX, BPM_MIN, BPM_STEP, TAP_MAX, TAP_RESET_MS } from '@/domain/metronome';
import { metronome } from '@/engine/Metronome';
import { useLive } from '@/store/liveStore';

export function Metronome() {
  const m = useLive((s) => s.metronome);
  const [open, setOpen] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 바깥 클릭·Esc로 닫기 (열려 있을 때만 리스너를 건다)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 탭 표시 초기화 타이머 정리
  useEffect(
    () => () => {
      if (tapTimer.current) clearTimeout(tapTimer.current);
    },
    [],
  );

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (m.playing) metronome.stop();
    else void metronome.start().catch(() => {});
  };

  const onTap = () => {
    setTapCount(metronome.tap());
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTapCount(0), TAP_RESET_MS);
  };

  const dots = Array.from({ length: m.beatsPerBar }, (_, i) => i);

  return (
    <div className="metro" ref={rootRef}>
      <div className="metro-chip-wrap">
        <button
          type="button"
          className="metro-chip"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label="메트로놈 설정"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="metro-dots" aria-hidden="true">
            {dots.map((i) => (
              <span key={i} className={`metro-dot${m.playing && m.beat === i ? ' on' : ''}${i === 0 ? ' accent' : ''}`} />
            ))}
          </span>
          <span className="metro-bpm">{m.bpm}</span>
        </button>
        <button
          type="button"
          className="metro-toggle"
          aria-label={m.playing ? '메트로놈 정지' : '메트로놈 재생'}
          onClick={toggle}
        >
          {m.playing ? '■' : '▶'}
        </button>
      </div>

      {open && (
        <div className="metro-pop" role="dialog" aria-label="메트로놈">
          <div className="metro-pop-bpm">
            <button type="button" onClick={() => metronome.setBpm(m.bpm - BPM_STEP)} aria-label={`BPM ${BPM_STEP} 감소`}>
              -{BPM_STEP}
            </button>
            <span className="metro-pop-num">{m.bpm}</span>
            <button type="button" onClick={() => metronome.setBpm(m.bpm + BPM_STEP)} aria-label={`BPM ${BPM_STEP} 증가`}>
              +{BPM_STEP}
            </button>
          </div>
          <input
            type="range"
            min={BPM_MIN}
            max={BPM_MAX}
            step={1}
            value={m.bpm}
            aria-label="BPM"
            onChange={(e) => metronome.setBpm(Number(e.target.value))}
          />
          <div className="metro-seg" role="group" aria-label="박자">
            {BEATS_PER_BAR_OPTIONS.map((n) => (
              <button key={n} type="button" aria-pressed={m.beatsPerBar === n} onClick={() => metronome.setBeatsPerBar(n)}>
                {n}/4
              </button>
            ))}
          </div>
          <div className="metro-tap">
            <button type="button" onClick={onTap}>
              탭 템포
            </button>
            <span className="small faint">{tapCount > 0 ? `${tapCount}/${TAP_MAX}` : ''}</span>
          </div>
        </div>
      )}
    </div>
  );
}
