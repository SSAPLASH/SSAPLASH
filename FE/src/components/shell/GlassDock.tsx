// 상단 글래스 Dock(Figma Navigation / GlassDock 148:2288). mode(shell|play) × collapsed 4변이.
// 상태는 liveStore.metronome·settingsStore, 조작은 engine 싱글턴 메서드만 쓴다. 셸 루트에 fixed로 한 인스턴스만 둔다(D3).
// 메트로놈 패널(MetronomePanel)은 Radix Popover(비모달)로 연다 — 열림 상태는 shellStore.dockPanel이 쥐고(제어 모드), 내용은 포털로 body에 붙는다.
// 프리셋 칩은 두지 않는다(11/04 결정, 연결 상태는 상단 바 스틱 상태 표시가 보여 준다).
import * as Popover from '@radix-ui/react-popover';
import { AnimatePresence, m, useAnimate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
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
import { DOCK_SWAP_FROM, DOCK_TRANSITION, PANEL_TRANSITION } from './dockMotion';
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

  // 접힘 ↔ 펼침: 크기를 보간하지 않고 내용을 바로 바꾼 뒤 틀 전체를 살짝 작고 흐린 상태에서 제자리로 띄운다(QA 352).
  // 크기 보간은 scale 왜곡·교차 페이드 튐이 생겼다. toolbar 노드는 그대로 두어 초점·자동 접힘 핸들러가 유지된다
  const [dockRef, animateDock] = useAnimate<HTMLDivElement>();
  const reduceMotion = useReducedMotion();
  const prevCollapsed = useRef(collapsed);
  useEffect(() => {
    if (prevCollapsed.current === collapsed) return;
    prevCollapsed.current = collapsed;
    if (reduceMotion || !dockRef.current) return;
    void animateDock(dockRef.current, { opacity: [DOCK_SWAP_FROM.opacity, 1], scale: [DOCK_SWAP_FROM.scale, 1] }, DOCK_TRANSITION);
  }, [collapsed, reduceMotion, animateDock, dockRef]);

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
  const panelRef = useRef<HTMLDivElement>(null);
  const panelOpen = dockPanel === 'metronome';
  const pause = () => useLive.setState({ pauseRequested: 'menu' });

  return (
    <Popover.Root open={panelOpen} onOpenChange={(o) => setDockPanel(o ? 'metronome' : null)} modal={false}>
      {/* 바깥 틀은 하나로 유지한다(D3). 전환은 위 useAnimate가 맡는다 */}
      <div
        ref={dockRef}
        className={`glass-dock${collapsed ? ' collapsed' : ''} ${mode}`}
        role="toolbar"
        aria-label="Dock"
        onPointerDownCapture={collapsed ? undefined : auto.touch}
        onKeyDownCapture={collapsed ? undefined : auto.touch}
        onFocusCapture={collapsed ? undefined : auto.touch}
      >
        {collapsed ? (
            <div className="dock-inner">
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
            </div>
          ) : (
            <div className="dock-inner">
              <SoundToggle />
              <span className="dock-divider" />
              <Popover.Anchor asChild>
                <div className={`dock-metro-chip${locked ? ' locked' : ''}`}>
                  <Popover.Trigger asChild>
                    <button type="button" className="dock-metro-body" aria-label="메트로놈 설정" title="메트로놈 설정">
                      <MetroIcon />
                      <span className="dock-bpm">{met.bpm}</span>
                    </button>
                  </Popover.Trigger>
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
              </Popover.Anchor>
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
            </div>
          )}
      </div>
      {/* key로 접힘 ↔ 펼침 때 AnimatePresence를 새로 만든다 — 앵커(칩)가 사라질 때 패널이 닫힘 애니메이션 중 엉뚱한 위치로 튀지 않고 즉시 언마운트된다.
          라우트 변경 등 다른 이유로 닫힐 때는 페이드 아웃 후 언마운트 */}
      <AnimatePresence key={collapsed ? 'collapsed' : 'expanded'}>
        {panelOpen && !collapsed && (
          <Popover.Portal key="metronome-panel" forceMount>
            <Popover.Content
              asChild
              forceMount
              side="bottom"
              align="start"
              sideOffset={8}
              collisionPadding={12}
              aria-label="메트로놈 설정"
              onOpenAutoFocus={(e) => {
                // 열릴 때 첫 조작(켜기 토글)으로 초점 — 닫힐 때는 Radix 기본대로 칩으로 돌아간다
                e.preventDefault();
                panelRef.current?.querySelector<HTMLElement>('[role="switch"]')?.focus();
              }}
              // 칩 안의 켜기 스위치 클릭은 패널을 닫지 않는다(기존 동작). 칩 본체는 트리거가 직접 토글한다
              onInteractOutside={(e) => {
                if ((e.target as Element | null)?.closest('.dock-metro-chip')) e.preventDefault();
              }}
            >
              <m.div
                ref={panelRef}
                className="metro-popover"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={PANEL_TRANSITION}
              >
                <MetronomePanel />
              </m.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  );
}
