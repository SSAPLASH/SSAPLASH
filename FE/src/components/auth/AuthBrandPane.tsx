// 로그인·가입 동의 화면 왼쪽 브랜드 영역(워드마크·슬로건·흐린 드럼 킷). 두 화면이 같은 2분할 틀을 쓴다.
import { DEFAULT_KIT_LAYOUT } from '@/domain/kitLayout';
import { KitCanvas } from '@/components/KitCanvas';

export function AuthBrandPane() {
  return (
    <section className="login-brand">
      <div className="login-wordmark">SSAPLASH</div>
      <p className="login-slogan">스틱 하나로 시작하는 나의 첫 드럼</p>
      <div className="login-kit" aria-hidden="true">
        <KitCanvas layout={DEFAULT_KIT_LAYOUT} />
      </div>
    </section>
  );
}
