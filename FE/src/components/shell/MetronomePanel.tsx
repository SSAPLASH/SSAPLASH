// Figma 228:5712 메트로놈 패널 — Dock 아래 오른쪽 360 팝오버. 머리(켜기) · BPM −/+ · 박자 · 탭 템포 · 메트로놈 음량.
// 값의 주인은 engine/Metronome(조작은 엔진 메서드), 화면 값은 liveStore.metronome, 음량만 settingsStore.
// 열림·바깥 클릭·Esc·포커스 복귀는 GlassDock의 Radix Popover가 맡는다 — 이 컴포넌트는 Popover.Content 안 본문만 그린다. 연주는 멈추지 않는다.
import { BPM_STEP, type BeatsPerBar } from '@/domain/time/metronome';
import { metronome } from '@/engine/Metronome';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Segmented } from '@/components/ui/Segmented';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import './metronome-panel.css';

const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const BEAT_OPTIONS = [
  { value: '4', label: '4/4' },
  { value: '3', label: '3/4' },
];

/** gameDisabled: 리듬 게임 — 메트로놈을 쓰지 않으므로 켜기·BPM·박자·탭을 모두 비활성으로 둔다(설계 MODE-001-play-quick-start E1) */
export function MetronomePanel({ gameDisabled = false }: { gameDisabled?: boolean }) {
  const m = useLive((s) => s.metronome);
  const clickOn = useSettings((s) => s.metronome);
  const setClickOn = useSettings((s) => s.setMetronome);
  const volume = useSettings((s) => s.metronomeVolume);
  const setVolume = useSettings((s) => s.setMetronomeVolume);

  const gameNoMetro = gameDisabled;
  const locked = m.locked || gameNoMetro;
  const running = gameNoMetro ? false : m.locked ? clickOn : m.playing;

  const onToggle = () => {
    if (gameNoMetro) return;
    if (m.locked) {
      setClickOn(!clickOn);
      return;
    }
    if (m.playing) metronome.stop();
    else void metronome.start().catch(() => {});
  };

  return (
    <div className="metro-panel">
      <div className="metro-panel-head">
        <h2 className="metro-panel-title">메트로놈</h2>
        <Toggle checked={running} disabled={gameNoMetro} onChange={onToggle} label={m.locked ? '메트로놈 클릭 켜기' : '메트로놈 켜기'} />
      </div>

      <div className="metro-panel-bpm">
        <IconButton size="sm" disabled={locked} label={`BPM ${BPM_STEP} 감소`} onClick={() => metronome.setBpm(m.bpm - BPM_STEP)}>
          <svg {...iconProps}>
            <path d="M6 12h12" />
          </svg>
        </IconButton>
        <div className="metro-panel-bpm-value">
          <span className="metro-panel-bpm-num" aria-live="polite">
            {m.bpm}
          </span>
          <span className="metro-panel-bpm-unit">BPM</span>
        </div>
        <IconButton size="sm" disabled={locked} label={`BPM ${BPM_STEP} 증가`} onClick={() => metronome.setBpm(m.bpm + BPM_STEP)}>
          <svg {...iconProps}>
            <path d="M6 12h12M12 6v12" />
          </svg>
        </IconButton>
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
        <Button variant="secondary" size="sm" disabled={locked} onClick={() => metronome.tap()}>
          탭 템포
        </Button>
      </div>
      {gameNoMetro ? (
        <p className="metro-panel-note">리듬 게임에서는 메트로놈을 쓰지 않아요</p>
      ) : (
        locked && <p className="metro-panel-note">곡 연주 중에는 곡의 BPM·박자로 고정돼요</p>
      )}

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
