// 상단 바: 로고(워드마크 이미지)·앵커·로그인 버튼. 스크롤이 조금 내려가면 반투명 배경이 깔린다.
import { useEffect, useState } from 'react';
import { NAV_LINKS } from './landingContent';

interface Props {
  /** false면 로그인 버튼 자리를 비운다(로그인 확인 중) */
  showLogin: boolean;
  onStart: () => void;
  onNavigate: (sceneId: string) => void;
}

export function LandingNav({ showLogin, onStart, onNavigate }: Props) {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    // 경계(40px)를 넘을 때만 상태가 바뀌므로 매 스크롤마다 리렌더하지 않는다
    const update = () => setSolid(window.scrollY > 40);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    onNavigate(id);
  };

  return (
    <header className={solid ? 'lp-nav lp-solid' : 'lp-nav'}>
      <a className="lp-logo" href="#hero" onClick={go('hero')}>
        <img src="/images/ssaplash-wordmark.webp" alt="SSAPLASH" width={744} height={96} draggable={false} />
      </a>
      <nav className="lp-nav-links" aria-label="랜딩 섹션">
        {NAV_LINKS.map((l) => (
          <a key={l.id} href={`#${l.id}`} onClick={go(l.id)}>
            {l.label}
          </a>
        ))}
      </nav>
      {showLogin ? (
        <button type="button" className="lp-pill" onClick={onStart}>
          로그인
        </button>
      ) : (
        <span className="lp-nav-slot" aria-hidden="true" />
      )}
    </header>
  );
}
