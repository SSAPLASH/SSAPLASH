// 상단 글래스 Dock(Figma Navigation / GlassDock 148:2288). mode(shell|play) × collapsed 4변이.
// 상태는 liveStore.metronome·settingsStore, 조작은 engine 싱글턴 메서드만 쓴다. 셸 루트에 fixed로 한 인스턴스만 둔다(D3).
// 메트로놈 패널(탭 템포·박자·슬라이더)은 묶음 4에서 만든다 — 칩 본체 클릭은 shellStore.dockPanel만 토글한다.
import { useNavigate } from 'react-router-dom';
import { BPM_STEP } from '@/domain/metronome';
import { metronome } from '@/engine/Metronome';
import { useLive } from '@/store/liveStore';
import { usePresets } from '@/store/presetStore';
import { useSettings } from '@/store/settingsStore';
import { useShellStore } from '@/store/shellStore';
import { SoundToggle } from './SoundToggle';

const svgProps = {
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

function MetroIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...svgProps} width={size} height={size}>
      <path d="M8 21h8l-2.5-16h-3z" />
      <path d="M12 17L16 7" />
    </svg>
  );
}

function PauseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...svgProps} width={size} height={size}>
      <path d="M9 6v12M15 6v12" />
    </svg>
  );
}

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={up ? 'M1 5l4-4 4 4' : 'M1 1l4 4 4-4'} />
    </svg>
  );
}

export function GlassDock() {
  const m = useLive((s) => s.metronome);
  const clickOn = useSettings((s) => s.metronome);
  const setClickOn = useSettings((s) => s.setMetronome);
  const collapsed = useSettings((s) => s.dockCollapsed);
  const setCollapsed = useSettings((s) => s.setDockCollapsed);
  const activePresetId = useSettings((s) => s.activePresetId);
  const presets = usePresets((s) => s.items);
  const immersive = useShellStore((s) => s.immersive);
  const dockPanel = useShellStore((s) => s.dockPanel);
  const setDockPanel = useShellStore((s) => s.setDockPanel);
  const navigate = useNavigate();

  const mode = immersive ? 'play' : 'shell';
  const locked = m.locked;
  const running = locked ? clickOn : m.playing;
  const presetName = presets.find((p) => p.id === activePresetId)?.name ?? '프리셋 없음';

  // 잠금(곡 연주) 중 on/off는 세션 클릭 on/off, 아니면 메트로놈 재생·정지
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (locked) {
      setClickOn(!clickOn);
      return;
    }
    if (m.playing) metronome.stop();
    else void metronome.start().catch(() => {});
  };
  const pause = () => useLive.setState({ pauseRequested: 'menu' });

  if (collapsed) {
    return (
      <div className={`glass-dock collapsed ${mode}`} role="toolbar" aria-label="Dock">
        <button type="button" className="dock-pill" aria-label="Dock 펼치기" onClick={() => setCollapsed(false)}>
          <span className={`dock-pill-metro${running ? ' on' : ''}`}>
            <MetroIcon size={16} />
          </span>
          <span className="dock-pill-bpm">{m.bpm}</span>
          <span className={`dock-pill-dot${running ? ' on' : ''}`} />
          {mode === 'play' && <PauseIcon size={16} />}
          <span className="dock-divider short" />
          <Chevron />
        </button>
      </div>
    );
  }

  return (
    <div className={`glass-dock ${mode}`} role="toolbar" aria-label="Dock">
      <SoundToggle />
      <span className="dock-divider" />
      <div className={`dock-metro-chip${locked ? ' locked' : ''}`}>
        <button
          type="button"
          className="dock-metro-body"
          aria-label="메트로놈 설정"
          aria-expanded={dockPanel === 'metronome'}
          title="메트로놈 설정"
          onClick={() => setDockPanel(dockPanel === 'metronome' ? null : 'metronome')}
        >
          <MetroIcon />
          <span className="dock-bpm">{m.bpm}</span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={running}
          className={`dock-switch${running ? ' on' : ''}`}
          aria-label={locked ? (clickOn ? '메트로놈 클릭 끄기' : '메트로놈 클릭 켜기') : m.playing ? '메트로놈 정지' : '메트로놈 재생'}
          title="메트로놈 켜기 / 끄기"
          onClick={toggle}
        >
          <span className="dock-switch-knob" />
        </button>
      </div>
      <button type="button" className="dock-icon-btn" disabled={locked} aria-label={`BPM ${BPM_STEP} 감소`} onClick={() => metronome.setBpm(m.bpm - BPM_STEP)}>
        <svg {...svgProps}>
          <path d="M6 12h12" />
        </svg>
      </button>
      <button type="button" className="dock-icon-btn" disabled={locked} aria-label={`BPM ${BPM_STEP} 증가`} onClick={() => metronome.setBpm(m.bpm + BPM_STEP)}>
        <svg {...svgProps}>
          <path d="M6 12h12M12 6v12" />
        </svg>
      </button>
      <span className="dock-divider" />
      <button type="button" className="dock-preset" title="드럼 세팅으로 이동" onClick={() => navigate('/setup')}>
        {presetName}
      </button>
      {mode === 'play' && (
        <button type="button" className="dock-icon-btn" aria-label="일시정지" title="일시정지" onClick={pause}>
          <PauseIcon />
        </button>
      )}
      <button type="button" className="dock-icon-btn dock-collapse" aria-label="Dock 접기" title="접기" onClick={() => setCollapsed(true)}>
        <Chevron up />
      </button>
    </div>
  );
}
