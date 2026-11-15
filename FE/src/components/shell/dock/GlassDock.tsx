// 상단 글래스 Dock(Figma Navigation / GlassDock 148:2288). mode(shell|play) × collapsed 4변이.
// 접기는 줄이기가 아니라 왼쪽 슬라이드다(설계 QA-page-header-dock-fold): « 를 누르면 메트로놈 칩·BPM ±·녹음 버튼 묶음이 폭 0으로 접히고
// 음소거·메트로놈 아이콘·(녹음 상태)·(일시정지)·» 만 같은 크기로 남는다. 남은 아이콘은 접힌 채로 바로 조작한다.
// 상태는 liveStore.metronome·settingsStore, 조작은 engine 싱글턴 메서드만 쓴다. 셸 루트에 fixed로 한 인스턴스만 둔다(D3).
// 메트로놈 패널(MetronomePanel)은 Radix Popover(비모달)로 연다 — 열림 상태는 shellStore.dockPanel이 쥐고(제어 모드), 내용은 포털로 body에 붙는다.
// 프리셋 칩은 두지 않는다(11/04 결정, 연결 상태는 상단 바 스틱 상태 표시가 보여 준다).
import * as Popover from '@radix-ui/react-popover';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RECORDING_ENABLED } from '@/config/features';
import { useRecordingStore } from '@/runtime/recordingStore';
import { BPM_STEP } from '@/domain/time/metronome';
import { metronome } from '@/engine/Metronome';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { useShellStore } from '@/store/shellStore';
import { RecordButton } from '@/components/recording/RecordButton';
import { recordButtonVisible } from '@/components/recording/recordButtonRoute';
import { IconButton } from '@/components/ui/action/IconButton';
import { createDockAutoCollapse } from './dockAutoCollapse';
import { metronomeDisabledRoute } from './metronomeRoute';
import { DOCK_SLIDE, DOCK_TRANSITION, PANEL_TRANSITION } from './dockMotion';
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

/** « (접기, 왼쪽) · » (펼치기, 오른쪽) */
function DoubleChevron({ left }: { left?: boolean }) {
  return (
    <svg {...svgProps} width={16} height={16}>
      {left ? <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" /> : <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />}
    </svg>
  );
}

function RecIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
    </svg>
  );
}

/** 접힘·펼침 때 폭 0 ↔ 제 폭으로 미끄러지는 묶음 */
function Slide({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <m.div className={`dock-slide ${className}`} initial={DOCK_SLIDE.hidden} animate={DOCK_SLIDE.shown} exit={DOCK_SLIDE.hidden} transition={DOCK_TRANSITION}>
      {children}
    </m.div>
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
  const dockRaised = useShellStore((s) => s.dockRaised);
  const setDockPanel = useShellStore((s) => s.setDockPanel);
  const playRunning = useShellStore((s) => s.playRunning);
  const { pathname } = useLocation();
  // 접힘 Dock의 녹음 점: 자유 녹음 중, 또는 악보에서 녹음을 켠 채 연주 중(리듬 게임은 녹음하지 않는다)
  const recordingDot = useRecordingStore(
    (s) => RECORDING_ENABLED && (s.phase === 'recording' || (s.phase === 'armed' && s.locked && recordButtonVisible(pathname))),
  );

  const mode = immersive ? 'play' : 'shell';
  // 연주 중(카운트인 이후·일시정지 아님)에는 저장된 설정 대신 로컬 자동 접힘 상태를 쓴다(UX-41)
  const autoMode = mode === 'play' && playRunning;
  const [auto] = useState(() => createDockAutoCollapse());
  const [autoCollapsed, setAutoCollapsed] = useState(true);
  const collapsed = autoMode ? autoCollapsed : savedCollapsed;
  const expand = () => (autoMode ? auto.expand() : setSavedCollapsed(false));
  const collapse = () => (autoMode ? auto.collapse() : setSavedCollapsed(true));
  const locked = met.locked;
  // 리듬 게임은 메트로놈을 쓰지 않는다: 켜짐 표시도 없고 조작은 모두 비활성
  const gameNoMetro = metronomeDisabledRoute(pathname);
  const running = gameNoMetro ? false : locked ? clickOn : met.playing;

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
    if (gameNoMetro) return;
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
  // 접힌 Dock의 녹음 상태: 녹음 버튼이 있는 화면이면 늘 보이고(꺼진 원), 녹음 중이면 빨간 원
  const recStatusShown = recordingDot || (RECORDING_ENABLED && recordButtonVisible(pathname));
  const metroLabel = gameNoMetro ? '리듬 게임에서는 메트로놈을 쓰지 않아요' : locked ? (clickOn ? '메트로놈 클릭 끄기' : '메트로놈 클릭 켜기') : met.playing ? '메트로놈 정지' : '메트로놈 재생';

  return (
    <Popover.Root open={panelOpen} onOpenChange={(o) => setDockPanel(o ? 'metronome' : null)} modal={false}>
      {/* 바깥 틀은 하나로 유지한다(D3). 접힘 ↔ 펼침은 안쪽 묶음이 폭 0 ↔ 제 폭으로 미끄러진다. 틀은 가운데 정렬이라 양쪽에서 함께 좁아진다 */}
      <div
        className={`glass-dock${collapsed ? ' collapsed' : ''} ${mode}`}
        role="toolbar"
        aria-label="Dock"
        onPointerDownCapture={collapsed ? undefined : auto.touch}
        onKeyDownCapture={collapsed ? undefined : auto.touch}
        onFocusCapture={collapsed ? undefined : auto.touch}
      >
        <div className="dock-inner">
          <SoundToggle />
          <AnimatePresence initial={false}>
            {collapsed ? (
              <Slide key="metro-mini" className="dock-slide-mini">
                {/* 접힘: 메트로놈은 아이콘 하나로 켜기·끄기(펼치지 않는다) */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={running}
                  className={`ui-icon-btn ui-icon-btn-sm dock-metro-mini${running ? ' on' : ''}`}
                  aria-label={metroLabel}
                  title={gameNoMetro ? metroLabel : '메트로놈 켜기 / 끄기'}
                  disabled={gameNoMetro}
                  onClick={toggle}
                >
                  <MetroIcon />
                </button>
              </Slide>
            ) : (
              <Slide key="extra" className="dock-slide-extra">
                <span className="dock-divider" />
                <Popover.Anchor asChild>
                  <div className={`dock-metro-chip${locked ? ' locked' : ''}${panelOpen ? ' open' : ''}`}>
                    <Popover.Trigger asChild>
                      <button type="button" className="dock-metro-body" aria-label="메트로놈 설정" title="메트로놈 설정">
                        <MetroIcon />
                        {/* 곡 BPM이 소수(78.43)여도 칸(40px)을 넘지 않게 정수로 보인다. 계산은 원래 값을 쓴다 */}
                        <span className="dock-bpm">{Math.round(met.bpm)}</span>
                      </button>
                    </Popover.Trigger>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={running}
                      className={`dock-switch${running ? ' on' : ''}`}
                      aria-label={metroLabel}
                      title={gameNoMetro ? metroLabel : '메트로놈 켜기 / 끄기'}
                      disabled={gameNoMetro}
                      onClick={toggle}
                    >
                      <span className="dock-switch-knob" />
                    </button>
                  </div>
                </Popover.Anchor>
                <IconButton size="sm" disabled={locked || gameNoMetro} label={`BPM ${BPM_STEP} 감소`} onClick={() => metronome.setBpm(met.bpm - BPM_STEP)}>
                  <svg {...svgProps}>
                    <path d="M6 12h12" />
                  </svg>
                </IconButton>
                <IconButton size="sm" disabled={locked || gameNoMetro} label={`BPM ${BPM_STEP} 증가`} onClick={() => metronome.setBpm(met.bpm + BPM_STEP)}>
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
              </Slide>
            )}
          </AnimatePresence>
          <AnimatePresence initial={false}>
            {collapsed && recStatusShown && (
              <Slide key="rec" className="dock-slide-mini">
                {/* 녹음 상태는 표시만 한다(조작은 펼친 Dock의 녹음 버튼). 녹음 중이 아니면 꺼진 원 */}
                <span className={`dock-rec-status${recordingDot ? ' on' : ''}`} role="img" aria-label={recordingDot ? '녹음 중' : '녹음 안 함'}>
                  <RecIcon />
                </span>
              </Slide>
            )}
          </AnimatePresence>
          {mode === 'play' && (
            <IconButton size="sm" label="일시정지" onClick={pause}>
              <PauseIcon />
            </IconButton>
          )}
          <IconButton size="sm" className="dock-collapse" label={collapsed ? 'Dock 펼치기' : 'Dock 접기'} title={collapsed ? '펼치기' : '접기'} onClick={collapsed ? expand : collapse}>
            <DoubleChevron left={!collapsed} />
          </IconButton>
        </div>
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
                // 열릴 때 첫 조작(박자에서 고른 칸, 잠겨 있으면 박 분할)으로 초점 — 닫힐 때는 Radix 기본대로 칩으로 돌아간다
                e.preventDefault();
                panelRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]:not(:disabled)')?.focus();
              }}
              // 칩 안의 켜기 스위치 클릭은 패널을 닫지 않는다(기존 동작). 칩 본체는 트리거가 직접 토글한다
              onInteractOutside={(e) => {
                if ((e.target as Element | null)?.closest('.dock-metro-chip')) e.preventDefault();
              }}
            >
              <m.div
                ref={panelRef}
                className={`metro-popover${dockRaised ? ' raised' : ''}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={PANEL_TRANSITION}
              >
                <MetronomePanel gameDisabled={gameNoMetro} />
              </m.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  );
}
