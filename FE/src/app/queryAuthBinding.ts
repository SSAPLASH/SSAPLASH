// 로그인 사용자가 바뀌면 서버 데이터 캐시를 모두 비운다 (설계 TECH-351 U4).
// 같은 탭에서 로그아웃 뒤 다른 계정으로 로그인해도 이전 계정의 내 곡·기록이 보이지 않게 한다.
import type { QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/store/authStore';

type AuthSnapshot = { status: string; user: { id: number } | null };

/** 로그인한 사용자 id. 로그인 상태가 아니면 null */
function userIdOf(s: AuthSnapshot): number | null {
  return s.status === 'authenticated' ? (s.user?.id ?? null) : null;
}

/** 알던 사용자가 없어지거나 다른 사용자로 바뀌면 clear()한다. 비로그인 → 로그인(첫 복원)은 비우지 않는다. 구독 해제 함수를 돌려준다 */
export function bindQueryCacheToAuth(client: QueryClient): () => void {
  let prev = userIdOf(useAuth.getState());
  return useAuth.subscribe((s) => {
    const next = userIdOf(s);
    if (next === prev) return;
    const changed = prev !== null;
    prev = next;
    if (changed) client.clear();
  });
}
