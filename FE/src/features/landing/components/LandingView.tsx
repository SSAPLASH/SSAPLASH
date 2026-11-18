// 랜딩 전체 화면(표시 전용). 라우트·로그인 팝업은 이 컴포넌트를 쓰는 쪽(features/landing/LandingPage)이 맡는다.
import { useCallback, useEffect, useRef } from 'react';
import './landing.css';
import { ChartScene } from './scene/ChartScene';
import { CtaSection } from './CtaSection';
import { HeroScene } from './scene/HeroScene';
import { LandingNav } from './LandingNav';
import { LANDING_MODES, type LandingModeKey } from './landingContent';
import { ModesScene } from './scene/ModesScene';
import { ResultSection } from './ResultSection';
import { StatementScene } from './scene/StatementScene';
import { StickScene } from './scene/StickScene';

export interface LandingViewProps {
  /** 헤더 로그인, CTA "로그인하고 시작하기" */
  onStart: () => void;
  /** 히어로·모드 섹션 카드, 단축키 1·2·3 */
  onMode: (key: LandingModeKey) => void;
  /** false면 헤더 로그인 버튼 자리를 비운다(로그인 확인 중) */
  showLogin: boolean;
}

// 입력창에 포커스가 있으면 단축키를 가로채지 않는다
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function LandingView({ onStart, onMode, showLogin }: LandingViewProps) {
  // 리스너를 매번 다시 달지 않도록 최신 콜백만 ref로 들고 있다
  const onModeRef = useRef(onMode);
  useEffect(() => {
    onModeRef.current = onMode;
  }, [onMode]);

  // 단축키 1·2·3: 히어로가 화면 상단에 있을 때만
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      const i = ['1', '2', '3'].indexOf(e.key);
      if (i < 0 || window.scrollY > window.innerHeight * 0.3) return;
      onModeRef.current(LANDING_MODES[i].key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scrollToScene = useCallback((id: string) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = reduce ? 'auto' : 'smooth';
    const hero = document.getElementById('hero');
    // 소개 앵커: 히어로 와이프가 끝나기 직전(시안: 히어로 끝 - 20vh)으로 가야 글자 채움이 처음부터 보인다.
    // 모션 줄이기에서는 장면이 풀려 있어 장면 시작점으로 간다.
    if (id === 'statement' && hero && !hero.classList.contains('lp-static')) {
      const top = hero.getBoundingClientRect().bottom + window.scrollY - window.innerHeight * 0.2;
      window.scrollTo({ top, behavior });
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior });
  }, []);

  return (
    <div className="lp">
      <LandingNav showLogin={showLogin} onStart={onStart} onNavigate={scrollToScene} />
      <HeroScene onMode={onMode} onScrollDown={() => scrollToScene('statement')} />
      <StatementScene />
      <StickScene />
      <ChartScene />
      <ModesScene onMode={onMode} />
      <ResultSection />
      <CtaSection onStart={onStart} onNavigate={scrollToScene} />
    </div>
  );
}
