import { describe, expect, it } from 'vitest';
import { songStatusView } from './songCatalog';

describe('songStatusView', () => {
  it('BE 곡 상태를 화면 문구와 색으로 바꾼다', () => {
    expect(songStatusView('READY')).toEqual({ label: '완료', tone: 'default' });
    expect(songStatusView('PROCESSING')).toEqual({ label: '채보 생성 중', tone: 'active' });
    expect(songStatusView('FAILED')).toEqual({ label: '생성 실패', tone: 'danger' });
  });

  it('모르는 상태는 원문 그대로 둔다', () => {
    expect(songStatusView('ARCHIVED')).toEqual({ label: 'ARCHIVED', tone: 'default' });
  });
});
