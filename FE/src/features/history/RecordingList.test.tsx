import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RecordingSummary } from '@/domain/recording';
import { RecordingBoard, type RecordingBoardProps } from './RecordingList';

vi.mock('@/api/recordings');

const summary = (over: Partial<RecordingSummary> = {}): RecordingSummary => ({
  id: 1,
  clientKey: 'k1',
  title: '내 연주',
  mode: 'FREE',
  inputSource: 'KEYBOARD',
  playId: null,
  hitCount: 1904,
  durationMs: 83_400,
  startedAt: new Date(2026, 10, 3, 14, 5).toISOString(),
  createdAt: '2026-11-03T05:06:00Z',
  updatedAt: '2026-11-03T05:06:00Z',
  song: null,
  ...over,
});

const base: RecordingBoardProps = {
  items: [],
  total: 0,
  hasNext: false,
  loading: false,
  error: null,
  mode: 'ALL',
  sort: 'NEWEST',
  q: '',
  playingId: null,
  loadingId: null,
  progress: 0,
};

const render = (props: Partial<RecordingBoardProps>) => renderToStaticMarkup(<RecordingBoard {...base} {...props} />);

describe('RecordingBoard', () => {
  it('머리글 7열 문구와 순서', () => {
    const html = render({ items: [summary()], total: 1 });
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(head.match(/<th /g)).toHaveLength(7);
    const labels = ['재생', '제목 · 곡', '모드', '녹음 시각', '길이', '타격', '메뉴'];
    let at = -1;
    for (const label of labels) {
      const next = head.indexOf(label, at + 1);
      expect(next, label).toBeGreaterThan(at);
      at = next;
    }
    expect(head).toContain('aria-label="정렬"');
  });

  it('도구 줄: 개수 문구, 모드 필터, 제목 검색', () => {
    const html = render({ items: [summary()], total: 3 });
    expect(html).toContain('녹음 3개 · 최대 200개');
    expect(html).toContain('aria-label="모드 필터"');
    for (const label of ['전체', '자유', '게임', '악보']) expect(html).toContain(`>${label}<`);
    expect(html).toContain('placeholder="제목 검색"');
    expect(html).toContain('type="search"');
  });

  it('행 열 내용: 제목·모드명·날짜·길이·타격 콤마·메뉴 라벨', () => {
    const html = render({ items: [summary()], total: 1 });
    const body = html.slice(html.indexOf('<tbody'));
    expect(body).toContain('내 연주');
    expect(body).toContain('자유 연습');
    expect(body).toContain('2026.11.03 14:05');
    expect(body).toContain('1:23');
    expect(body).toContain('1,904타');
    expect(body).toContain('aria-label="내 연주 메뉴"');
    expect(body).toContain('aria-label="재생"');
    expect(body).not.toContain('rec-list-song');
  });

  it('song이 있으면 곡 제목과 LevelBadge', () => {
    const html = render({
      items: [summary({ mode: 'RHYTHM', song: { songId: 7, title: '곡 제목', difficulty: 'HARD' } })],
      total: 1,
    });
    expect(html).toContain('곡 제목');
    expect(html).toContain('song-level-hard');
    expect(html).toContain('song-level-sm');
    expect(html).toContain('리듬 게임');
  });

  it('알 수 없는 난이도면 배지 없이 곡 제목만', () => {
    const html = render({ items: [summary({ song: { songId: 7, title: '곡 제목', difficulty: 'WEIRD' } })], total: 1 });
    expect(html).toContain('곡 제목');
    expect(html).not.toContain('song-level');
  });

  it('재생 중 행: playing 클래스, 진행 바, 정지 라벨', () => {
    const html = render({ items: [summary(), summary({ id: 2, title: '다른 녹음' })], total: 2, playingId: 1, progress: 0.4 });
    expect(html.match(/rec-list-row playing/g)).toHaveLength(1);
    expect(html).toContain('aria-label="정지"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('width:40%');
    expect(html.match(/role="progressbar"/g)).toHaveLength(1);
  });

  it('상세 로딩 중인 행은 aria-busy', () => {
    const html = render({ items: [summary()], total: 1, loadingId: 1 });
    expect(html).toContain('aria-busy="true"');
  });

  it('hasNext면 더 보기, 아니면 없음, 더 보기 로딩 글자', () => {
    expect(render({ items: [summary()], total: 30, hasNext: true })).toContain('>더 보기<');
    expect(render({ items: [summary()], total: 1 })).not.toContain('더 보기');
    const loading = render({ items: [summary()], total: 30, hasNext: true, loadingMore: true });
    expect(loading).toContain('>불러오는 중…<');
    expect(loading).not.toContain('>더 보기<');
  });

  it('조건 없는 0건은 EmptyState', () => {
    const html = render({});
    expect(html).toContain('아직 녹음이 없어요');
    expect(html).toContain('상단 녹음 버튼으로 연주를 남겨 보세요.');
    expect(html).not.toContain('<table');
  });

  it('조건(모드·검색어) 있는 0건은 조건 문구', () => {
    for (const props of [{ mode: 'FREE' as const }, { q: '재즈' }]) {
      const html = render(props);
      expect(html).toContain('ui-empty-sm');
      expect(html).toContain('조건에 맞는 녹음이 없어요');
      expect(html).not.toContain('아직 녹음이 없어요');
    }
  });

  it('첫 조회 로딩과 오류 문구·다시 시도', () => {
    expect(render({ loading: true })).toContain('불러오는 중…');
    const html = render({ error: '목록을 불러오지 못했어요' });
    expect(html).toContain('녹음 목록 로딩 실패');
    expect(html).toContain('목록을 불러오지 못했어요');
    expect(html).toContain('>다시 시도<');
    expect(html).not.toContain('<table');
  });
});
