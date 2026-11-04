// 상단 글래스 Dock(Figma Navigation / GlassDock 148:2288). mode(shell|play) × collapsed 4변이.
// 상태는 liveStore.metronome·settingsStore, 조작은 engine 싱글턴 메서드만 쓴다. 셸 루트에 fixed로 한 인스턴스만 둔다(D3).
// 메트로놈 패널(MetronomePanel)은 이 컴포넌트가 .shell-dock 안에 같이 마운트한다 — 칩 본체 클릭은 shellStore.dockPanel만 토글한다.
// 프리셋 칩은 두지 않는다(11/04 결정, 연결 상태는 상단 바 스틱 상태 표시가 보여 준다).
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RECORDING_ENABLED } from '@/app/features';
import { useRecordingStore } from '@/app/recordingStore';
import { BPM_STEP } from '@/domain/metronome';
import { metronome } from '@/engine/Metronome';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { useShellStore } from '@/store/shellStore';
import { RecordButton } from '@/components/recording/RecordButton';
import { recordButtonVisible } from '@/components/recording/recordButtonRoute';
import { IconButton } from '@/components/ui/IconButton';
import { createDockAutoCollapse } from './dockAutoCollapse';
import { DOCK_RADIUS_COLLAPSED, DOCK_RADIUS_EXPANDED, DOCK_TRANSITION } from './dockMotion';
import './glass-dock.css';
import { MetronomePanel } from './MetronomePanel';
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
  const met = useLive((s) => s.metronome);
  const clickOn = useSettings((s) => s.metronome);
  const setClickOn = useSettings((s) => s.setMetronome);
  const savedCollapsed = useSettings((s) => s.dockCollapsed);
  const setSavedCollapsed = useSettings((s) => s.setDockCollapsed);
  const immersive = useShellStore((s) => s.immersive);
  const dockPanel = useShellStore((s) => s.dockPanel);
  const setDockPanel = useShellStore((s) => s.setDockPanel);
  const playRunning = useShellStore((s) => s.playRunning);
  const { pathname } = useLocation();
  // 접힘 Dock의 녹음 점: 자유 녹음 중, 또는 게임·악보에서 녹음을 켠 채 연주 중
  const recordingDot = useRecordingStore((s) => RECORDING_ENABLED && (s.phase === 'recording' || (s.phase === 'armed' && s.locked)));

  const mode = immersive ? 'play' : 'shell';
  // 연주 중(카운트인 이후·일시정지 아님)에는 저장된 설정 대신 로컬 자동 접힘 상태를 쓴다(UX-41)
  const autoMode = mode === 'play' && playRunning;
  const [auto] = useState(() => createDockAutoCollapse());
  const [autoCollapsed, setAutoCollapsed] = useState(true);
  const collapsed = autoMode ? autoCollapsed : savedCollapsed;
  const expand = () => (autoMode ? auto.expand() : setSavedCollapsed(false));
  const collapse = () => (autoMode ? auto.collapse() : setSavedCollapsed(true));
  const locked = met.locked;
  const running = locked ? clickOn : met.playing;

  useEffect(() => auto.subscribe(setAutoCollapsed), [auto]);
  useEffect(() => {
    auto.setActive(autoMode);
  }, [auto, autoMode]);
  useEffect(() => {
    auto.setPanelOpen(dockPanel === 'metronome');
  }, [auto, dockPanel]);

  // 라우트가 바뀌거나 Dock이 접히면 메트로놈 패널을 닫는다
  useEffect(() => {
    setDockPanel(null);
  }, [pathname, collapsed, setDockPanel]);

  // 잠금(곡 연주) 중 on/off는 세션 클릭 on/off, 아니면 메트로놈 재생·정지
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (locked) {
      setClickOn(!clickOn);
      return;
    }
    if (met.playing) metronome.stop();
    else void metronome.start().catch(() => {});
  };
  const pause = () => useLive.setState({ pauseRequested: 'menu' });

  return (
    <>
      {/* 바깥 틀은 하나로 유지해 알약 ↔ 막대가 이어서 변한다(D3). 모서리 반경은 style로 motion이 보간한다
          (layout 애니메이션 중 크기 scale에 모서리가 늘어나는 왜곡을 motion이 보정한다) */}
      <m.div
        layout
        transition={{ layout: DOCK_TRANSITION }}
        style={{ borderRadius: collapsed ? DOCK_RADIUS_COLLAPSED : DOCK_RADIUS_EXPANDED }}
        className={`glass-dock${collapsed ? ' collapsed' : ''} ${mode}`}
        role="toolbar"
        aria-label="Dock"
        onPointerDownCapture={collapsed ? undefined : auto.touch}
        onKeyDownCapture={collapsed ? undefined : auto.touch}
        onFocusCapture={collapsed ? undefined : auto.touch}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {collapsed ? (
            <m.div key="collapsed" className="dock-inner" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={DOCK_TRANSITION}>
              <button type="button" className="dock-pill" aria-label="Dock 펼치기" onClick={expand}>
                <span className={`dock-pill-metro${running ? ' on' : ''}`}>
                  <MetroIcon size={16} />
                </span>
                <span className="dock-pill-bpm">{met.bpm}</span>
                <span className={`dock-pill-dot${running ? ' on' : ''}`} />
                {recordingDot && <span className="dock-pill-rec" aria-hidden="true" />}
                {mode === 'play' && <PauseIcon size={16} />}
                <span className="dock-divider short" />
                <Chevron />
              </button>
            </m.div>
          ) : (
            <m.div key="expanded" className="dock-inner" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={DOCK_TRANSITION}>
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
                  <span className="dock-bpm">{met.bpm}</span>
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={running}
                  className={`dock-switch${running ? ' on' : ''}`}
                  aria-label={locked ? (clickOn ? '메트로놈 클릭 끄기' : '메트로놈 클릭 켜기') : met.playing ? '메트로놈 정지' : '메트로놈 재생'}
                  title="메트로놈 켜기 / 끄기"
                  onClick={toggle}
                >
                  <span className="dock-switch-knob" />
                </button>
              </div>
              <IconButton size="sm" disabled={locked} label={`BPM ${BPM_STEP} 감소`} onClick={() => metronome.setBpm(met.bpm - BPM_STEP)}>
                <svg {...svgProps}>
                  <path d="M6 12h12" />
                </svg>
              </IconButton>
              <IconButton size="sm" disabled={locked} label={`BPM ${BPM_STEP} 증가`} onClick={() => metronome.setBpm(met.bpm + BPM_STEP)}>
                <svg {...svgProps}>
                  <path d="M6 12h12M12 6v12" />
                </svg>
              </IconButton>
              {RECORDING_ENABLED && recordButtonVisible(pathname) && (
                <>
                  <span className="dock-divider" />
                  <RecordButton />
                </>
              )}
              {mode === 'play' && (
                <IconButton size="sm" label="일시정지" onClick={pause}>
                  <PauseIcon />
                </IconButton>
              )}
              <IconButton size="sm" className="dock-collapse" label="Dock 접기" title="접기" onClick={collapse}>
                <Chevron up />
              </IconButton>
            </m.div>
          )}
        </AnimatePresence>
      </m.div>
      {dockPanel === 'metronome' && <MetronomePanel />}
    </>
  );
}
