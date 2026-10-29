// 마이페이지 (ACCT-001, Jira 197). 프로필·최근 플레이를 한 화면에 모으고 회원 탈퇴 진입을 둔다.
// 라이브러리 요약은 두지 않는다(라이브러리 메뉴가 맡는다). 최근 플레이는 로그인 계정의 로컬 로그, 탈퇴는 authStore.withdraw.
// 최근 플레이의 BE 곡은 곡마다 한 번 상세를 조회해 삭제된 곡을 표시한다(CHART-001 U9).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { checkSongAvailability } from '@/api/songs';
import { RecentPlays, type RecentPlayItem } from '@/components/mypage/RecentPlays';
import { WithdrawDialog } from '@/components/shell/WithdrawDialog';
import type { SocialProvider } from '@/domain/auth';
import { songIdsToCheck } from '@/domain/songAvailability';
import { loadPlayLogs } from '@/engine/playLog';
import { useAuth } from '@/store/authStore';

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
  const navigate = useNavigate();

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // 로그의 주인은 로그인 계정이다(app/authBootstrap). 계정이 바뀌면 다시 읽는다
  const recentLogs = useMemo(() => (user ? loadPlayLogs().slice(0, RECENT_MAX) : []), [user]);

  // 삭제(404)로 확인된 곡 id. 다른 실패는 표시하지 않는다
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => {
    const ids = songIdsToCheck(recentLogs);
    if (ids.length === 0) return;
    const ctrl = new AbortController();
    void Promise.all(ids.map((id) => checkSongAvailability(id, ctrl.signal).then((a) => (a === 'deleted' ? id : null), () => null))).then(
      (found) => {
        if (!ctrl.signal.aborted) setDeletedIds(new Set(found.filter((id): id is number => id !== null)));
      },
    );
    return () => ctrl.abort();
  }, [recentLogs]);

  const recent = useMemo<RecentPlayItem[]>(
    () =>
      recentLogs.map((l) => ({
        playId: l.playId,
        title: l.title,
        mode: l.mode,
        difficulty: l.difficulty,
        startedAt: l.startedAt,
        accuracy: l.summary.accuracy,
        deleted: l.songNumericId != null && deletedIds.has(l.songNumericId),
      })),
    [recentLogs, deletedIds],
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

        <div className="card col">
          <h3>최근 플레이</h3>
          <RecentPlays items={recent} />
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
