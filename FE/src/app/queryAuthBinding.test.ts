import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserMe } from '@/domain/account/auth';
import { useAuth } from '@/store/authStore';
import { createQueryClient } from '@/runtime/queryClient';
import { bindQueryCacheToAuth } from './queryAuthBinding';

const client = createQueryClient();
let unbind = () => {};
const seed = () => client.setQueryData(['songs', 'list'], [1]);
const has = () => client.getQueryData(['songs', 'list']) !== undefined;
const login = (id: number) => useAuth.setState({ status: 'authenticated', user: { id } as UserMe });

beforeEach(() => {
  client.clear();
  useAuth.setState({ status: 'unknown', user: null });
  unbind = bindQueryCacheToAuth(client);
});
afterEach(() => unbind());

describe('bindQueryCacheToAuth (설계 TECH-351 U4)', () => {
  it('첫 로그인 복원(비로그인 → 로그인)은 캐시를 비우지 않는다', () => {
    seed();
    login(1);
    expect(has()).toBe(true);
  });
  it('로그아웃하면 비운다', () => {
    login(1);
    seed();
    useAuth.setState({ status: 'anonymous', user: null });
    expect(has()).toBe(false);
  });
  it('다른 사용자로 바뀌면 비우고, 같은 사용자의 다른 상태 변경은 그대로 둔다', () => {
    login(1);
    seed();
    useAuth.setState({ user: { id: 1, nickname: '바뀜' } as UserMe });
    expect(has()).toBe(true);
    login(2);
    expect(has()).toBe(false);
  });
});
