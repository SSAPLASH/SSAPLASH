// 마이페이지 (ACCT-001, Jira 197). 프로필·내 곡 상태·최근 플레이를 한 화면에 모으고 회원 탈퇴 진입을 둔다.
// 내 곡은 songStore(MINE), 최근 플레이는 로그인 계정의 로컬 로그, 탈퇴는 authStore.withdraw.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MySongSummary } from '@/components/mypage/MySongSummary';
import { RecentPlays, type RecentPlayItem } from '@/components/mypage/RecentPlays';
import { WithdrawDialog } from '@/components/shell/WithdrawDialog';
import type { SocialProvider } from '@/domain/auth';
import { loadPlayLogs } from '@/engine/playLog';
import { useAuth } from '@/store/authStore';
import { useSongs } from '@/store/songStore';

const PROVIDER_LABEL: Record<SocialProvider, string> = {
  GOOGLE: 'Google',
  SSAFY: 'SSAFY',
};

const RECENT_MAX = 5;

function joinedOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('ko-KR', { dateStyle: 'long' });
}

export function MyPage() {
  const user = useAuth((s) => s.user);
  const withdraw = useAuth((s) => s.withdraw);
  const songItems = useSongs((s) => s.items);
  const songStatus = useSongs((s) => s.status);
  const songScope = useSongs((s) => s.scope);
  const songError = useSongs((s) => s.error);
  const loadSongs = useSongs((s) => s.load);
  const navigate = useNavigate();

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const reloadSongs = useCallback(() => void loadSongs('MINE'), [loadSongs]);
  useEffect(() => {
    if (user) reloadSongs();
  }, [user, reloadSongs]);

  // 로그의 주인은 로그인 계정이다(app/authBootstrap). 계정이 바뀌면 다시 읽는다
  const recent = useMemo<RecentPlayItem[]>(
    () =>
      user
        ? loadPlayLogs()
            .slice(0, RECENT_MAX)
            .map((l) => ({
              playId: l.playId,
              title: l.title,
              mode: l.mode,
              difficulty: l.difficulty,
              startedAt: l.startedAt,
              accuracy: l.summary.accuracy,
            }))
        : [],
    [user],
  );

  if (!user) {
    // 인증 끔 개발 모드에서만 여기 온다. 운영 빌드는 RequireAuth가 로그인 화면으로 보낸다
    return (
      <main className="main">
        <div className="card col">
          <h3>마이페이지</h3>
          <p className="dim">
            <Link to="/login">로그인</Link>하면 내 정보와 기록을 볼 수 있습니다.
          </p>
        </div>
      </main>
    );
  }

  const openWithdraw = () => {
    setWithdrawError(null);
    setWithdrawOpen(true);
  };

  const onConfirmWithdraw = () => {
    setWithdrawBusy(true);
    setWithdrawError(null);
    withdraw().then(
      () => navigate('/login?error=withdrawn', { replace: true }),
      (e: unknown) => {
        // pages는 api를 import하지 않으므로 ApiError는 구조로 구분한다
        const { status, detail } = e instanceof Error ? (e as { status?: unknown; detail?: unknown }) : {};
        // 401은 탈퇴가 아니라 세션 만료다. store가 anonymous로 내렸으므로 RequireAuth가 로그인 화면으로 보낸다
        if (status === 401) return;
        setWithdrawError(typeof detail === 'string' && detail ? detail : '요청을 보내지 못했습니다. 다시 시도해 주세요.');
        setWithdrawBusy(false);
      },
    );
  };

  // 다른 화면(곡 선택)이 기본 곡 목록을 읽은 직후라면 MINE 결과가 올 때까지 로딩으로 본다
  const mineStatus = songScope === 'MINE' ? songStatus : 'loading';

  return (
    <main className="main">
      <section className="hero" style={{ padding: '24px 0 18px' }}>
        <h1>마이페이지</h1>
      </section>

      <div className="col" style={{ gap: 20 }}>
        <div className="card my-profile">
          {user.profileImageUrl ? (
            <img className="my-avatar" src={user.profileImageUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="my-avatar my-avatar-initial" aria-hidden="true">
              {Array.from(user.nickname)[0] ?? '?'}
            </span>
          )}
          <div className="col" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8 }}>
              <h2>{user.nickname}</h2>
              <span className="profile-badge">{PROVIDER_LABEL[user.provider] ?? user.provider} 로그인</span>
            </div>
            <span className="dim small">가입일 {joinedOf(user.createdAt)}</span>
          </div>
        </div>

        <div className="grid-2">
          <div className="card col">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>내 곡</h3>
              <Link to="/studio" className="small">
                내 곡 관리
              </Link>
            </div>
            <MySongSummary
              status={mineStatus}
              items={songScope === 'MINE' ? songItems : []}
              error={songError}
              onRetry={reloadSongs}
            />
          </div>
          <div className="card col">
            <h3>최근 플레이</h3>
            <RecentPlays items={recent} />
          </div>
        </div>

        <div className="card col my-danger">
          <h3>회원 탈퇴</h3>
          <p className="dim small">계정과 올린 곡이 삭제되며 되돌릴 수 없습니다.</p>
          <div>
            <button type="button" className="btn-danger" onClick={openWithdraw}>
              회원 탈퇴
            </button>
          </div>
        </div>
      </div>

      <WithdrawDialog
        open={withdrawOpen}
        busy={withdrawBusy}
        error={withdrawError}
        onCancel={() => setWithdrawOpen(false)}
        onConfirm={onConfirmWithdraw}
      />
    </main>
  );
}
