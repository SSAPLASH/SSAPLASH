// 셸 오른쪽 위 프로필 메뉴(아바타 28). 자기 완결 — 로그인 상태는 authStore만 읽는다.
// 아바타 버튼 → 닉네임·제공자·로그아웃 메뉴. 설정은 사이드바 하단에서 간다(QA 352).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SocialProvider } from '@/domain/account/auth';
import { Menu } from '@/components/ui/overlay/Menu';
import { useAuth } from '@/store/authStore';

const PROVIDER_LABEL: Record<SocialProvider, string> = {
  GOOGLE: 'Google',
  SSAFY: 'SSAFY',
};

export function ProfileMenu() {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  // 사진을 불러오지 못한 URL. 만료·차단된 제공자 사진이면 이니셜로 바꾼다
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (status !== 'authenticated' || !user) return null;

  const onLogout = () => {
    void logout().then(() => navigate('/', { replace: true }));
  };

  // 항목을 고르면 메뉴를 닫고 실행한다
  return (
    <Menu
      className="profile-wrap"
      menuClassName="profile-menu"
      menuLabel="프로필"
      renderTrigger={({ triggerProps }) => (
        <button type="button" className="profile-trigger" aria-label="프로필 메뉴" {...triggerProps}>
          {user.profileImageUrl && user.profileImageUrl !== failedSrc ? (
            <img
              className="profile-avatar"
              src={user.profileImageUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setFailedSrc(user.profileImageUrl)}
            />
          ) : (
            <span className="profile-avatar profile-initial" aria-hidden="true">
              {Array.from(user.nickname)[0] ?? '?'}
            </span>
          )}
        </button>
      )}
    >
      {({ close }) => (
        <>
          <div className="profile-name">{user.nickname}</div>
          <span className="profile-badge">{PROVIDER_LABEL[user.provider] ?? user.provider}</span>
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onLogout();
            }}
          >
            로그아웃
          </button>
        </>
      )}
    </Menu>
  );
}
