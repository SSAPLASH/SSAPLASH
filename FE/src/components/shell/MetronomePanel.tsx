// Figma 228:5712 메트로놈 패널 — Dock 아래 오른쪽 360 팝오버. 머리(켜기) · BPM −/+ · 박자 · 탭 템포 · 메트로놈 음량.
// 값의 주인은 engine/Metronome(조작은 엔진 메서드), 화면 값은 liveStore.metronome, 음량만 settingsStore.
// 바깥 클릭·Esc로 닫는다(Dock 칩 클릭은 칩이 직접 토글). 연주는 멈추지 않는다.
import { useEffect, useRef } from 'react';
import { BPM_STEP, type BeatsPerBar } from '@/domain/metronome';
import { metronome } from '@/engine/Metronome';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { useShellStore } from '@/store/shellStore';
import { Segmented } from '@/components/ui/Segmented';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import './metronome-panel.css';

const BEAT_OPTIONS = [
  { value: '4', label: '4/4' },
  { value: '3', label: '3/4' },
];

export function MetronomePanel() {
  const m = useLive((s) => s.metronome);
  const clickOn = useSettings((s) => s.metronome);
  const setClickOn = useSettings((s) => s.setMetronome);
  const volume = useSettings((s) => s.metronomeVolume);
  const setVolume = useSettings((s) => s.setMetronomeVolume);
  const setDockPanel = useShellStore((s) => s.setDockPanel);
  const panelRef = useRef<HTMLDivElement>(null);

  const locked = m.locked;
  const running = locked ? clickOn : m.playing;

  const onToggle = () => {
    if (locked) {
      setClickOn(!clickOn);
      return;
    }
    if (m.playing) metronome.stop();
    else void metronome.start().catch(() => {});
  };

  // 열릴 때 첫 조작(켜기 토글)으로 초점
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[role="switch"]')?.focus();
  }, []);

  // 바깥 클릭(Dock 메트로놈 칩은 제외 — 칩이 직접 토글한다)·Esc 닫기. Esc면 칩으로 초점 복원
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (panelRef.current?.contains(t) || t.closest('.dock-metro-chip')) return;
      setDockPanel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setDockPanel(null);
      document.querySelector<HTMLElement>('.dock-metro-body')?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [setDockPanel]);

  return (
    <div ref={panelRef} className="metro-panel motion-menu" role="dialog" aria-label="메트로놈 설정">
      <div className="metro-panel-head">
        <h2 className="metro-panel-title">메트로놈</h2>
        <Toggle checked={running} onChange={onToggle} label={locked ? '메트로놈 클릭 켜기' : '메트로놈 켜기'} />
      </div>

      <div className="metro-panel-bpm">
        <button
          type="button"
          className="metro-panel-step"
          disabled={locked}
          aria-label={`BPM ${BPM_STEP} 감소`}
          onClick={() => metronome.setBpm(m.bpm - BPM_STEP)}
        >
          −
        </button>
        <div className="metro-panel-bpm-value">
          <span className="metro-panel-bpm-num" aria-live="polite">
            {m.bpm}
          </span>
          <span className="metro-panel-bpm-unit">BPM</span>
        </div>
        <button
          type="button"
          className="metro-panel-step"
          disabled={locked}
          aria-label={`BPM ${BPM_STEP} 증가`}
          onClick={() => metronome.setBpm(m.bpm + BPM_STEP)}
        >
          +
        </button>
      </div>

      <div className="metro-panel-row">
        <Segmented
          label="박자"
          className={locked ? 'metro-panel-seg disabled' : 'metro-panel-seg'}
          options={BEAT_OPTIONS}
          value={String(m.beatsPerBar)}
          onChange={(v) => {
            if (!locked) metronome.setBeatsPerBar(Number(v) as BeatsPerBar);
          }}
        />
        <button type="button" className="metro-panel-tap" disabled={locked} onClick={() => metronome.tap()}>
          탭 템포
        </button>
      </div>
      {locked && <p className="metro-panel-note">곡 연주 중에는 곡의 BPM·박자로 고정돼요</p>}

      <Slider
        className="metro-panel-volume"
        label="메트로놈 음량"
        min={0}
        max={100}
        step={5}
        value={Math.round(volume * 100)}
        valueText={`${Math.round(volume * 100)}%`}
        onChange={(v) => setVolume(v / 100)}
      />
    </div>
  );
}
