import { describe, expect, it } from 'vitest';
import { loadRoute, type RouteKey } from './routeModules';

const KEYS: RouteKey[] = [
  'setup',
  'play',
  'sheet',
  'lessonRead',
  'miniList',
  'miniSpeed',
  'miniDynamics',
  'miniSight',
  'miniTempo',
  'studio',
  'settings',
  'history',
  'result',
  'report',
  'adminSongs',
  'landing',
  'sheetViewer',
];

describe('routeModules', () => {
  it('같은 키를 두 번 부르면 같은 Promise를 돌려준다', () => {
    expect(loadRoute('setup')).toBe(loadRoute('setup'));
  });

  it('표의 모든 키가 default가 컴포넌트 함수인 모듈로 풀린다', async () => {
    for (const key of KEYS) {
      const mod = await loadRoute(key);
      expect(typeof mod.default, key).toBe('function');
    }
  }, 60_000);
});
