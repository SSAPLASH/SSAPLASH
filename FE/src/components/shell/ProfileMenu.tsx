// 셸 오른쪽 위 프로필 메뉴(아바타 28). 자기 완결 — 로그인 상태는 authStore만 읽는다.
// 아바타 버튼 → 닉네임·제공자·설정·로그아웃 메뉴. 회원 탈퇴 등 계정 관리는 설정 화면에 둔다.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SocialProvider } from '@/domain/auth';
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭·Esc로 닫기 (열려 있을 때만 리스너를 건다)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (status !== 'authenticated' || !user) return null;

  const onLogout = () => {
    setOpen(false);
    void logout().then(() => navigate('/login', { replace: true }));
  };

  const onSettings = () => {
    setOpen(false);
    navigate('/settings');
  };

  return (
    <div className="profile-wrap" ref={rootRef}>
      <button
        type="button"
        className="profile-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="프로필 메뉴"
        onClick={() => setOpen((o) => !o)}
      >
        {user.profileImageUrl ? (
          <img className="profile-avatar" src={user.profileImageUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="profile-avatar profile-initial" aria-hidden="true">
            {Array.from(user.nickname)[0] ?? '?'}
          </span>
        )}
      </button>

      {open && (
        <div className="profile-menu motion-menu" role="menu" aria-label="프로필">
          <div className="profile-name">{user.nickname}</div>
          <span className="profile-badge">{PROVIDER_LABEL[user.provider] ?? user.provider}</span>
          <hr />
          <button type="button" role="menuitem" onClick={onSettings}>
            설정
          </button>
          <button type="button" role="menuitem" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
