import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaultRecordingTitle, type RecordingSummary } from '@/domain/play/recording';
import { RecordingBoard, type RecordingBoardProps } from './RecordingList';

vi.mock('@/api/play/recordings');

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
  paused: false,
  positionMs: 0,
};

const render = (props: Partial<RecordingBoardProps>) => renderToStaticMarkup(<RecordingBoard {...base} {...props} />);

describe('RecordingBoard', () => {
  it('표가 아니라 행 목록이고, 정렬 단추는 도구 줄에 있다(338 개편)', () => {
    const html = render({ items: [summary(), summary({ id: 2 })], total: 2 });
    expect(html).not.toContain('<table');
    expect(html).toContain('aria-label="녹음 보관함"');
    expect(html.match(/<li class="rec-list-row/g)).toHaveLength(2);
    const toolbar = html.slice(html.indexOf('history-toolbar'), html.indexOf('aria-label="녹음 보관함"'));
    expect(toolbar).toContain('aria-label="정렬"');
    expect(toolbar).toContain('>최신<');
    expect(toolbar).toContain('>오래된<');
  });

  it('도구 줄: 개수 문구, 모드 필터, 제목 검색', () => {
    const html = render({ items: [summary()], total: 3 });
    expect(html).toContain('녹음 3개 · 최대 200개');
    expect(html).toContain('aria-label="모드 필터"');
    for (const label of ['전체', '자유 연습', '리듬 게임', '악보 연습']) expect(html).toContain(`>${label}<`);
    expect(html).toContain('placeholder="제목 검색"');
    expect(html).toContain('type="search"');
  });

  it('행 열 내용: 제목·모드명·날짜·타격 콤마·메뉴 라벨, 길이는 재생바 끝(남은 시간)에만', () => {
    const html = render({ items: [summary()], total: 1 });
    const body = html.slice(html.indexOf('aria-label="녹음 보관함"'));
    expect(body).toContain('내 연주');
    expect(body).not.toContain('>길이<');
    expect(body).not.toContain('rec-list-meta');
    expect(body).not.toContain('타격 없음');
    expect(body).toContain('자유 연습');
    expect(body).toContain('2026.11.03 14:05');
    expect(body).toContain('>-1:23<');
    expect(body).toContain('1,904타');
    expect(body).toContain('aria-label="내 연주 메뉴"');
    expect(body).toContain('aria-label="「내 연주」 녹음 재생"');
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

  it('기본 제목 그대로인 녹음은 곡 제목과 녹음 시각을 한 번만 보인다', () => {
    const at = new Date(2026, 10, 3, 14, 5);
    const html = render({
      items: [summary({ title: defaultRecordingTitle('곡 제목', at), mode: 'SHEET', song: { songId: 7, title: '곡 제목', difficulty: 'HARD' } })],
      total: 1,
    });
    const body = html.slice(html.indexOf('aria-label="녹음 보관함"'));
    const info = body.slice(0, body.indexOf('rec-playbar'));
    expect(info.match(/>곡 제목</g)).toHaveLength(1);
    expect(info).not.toContain('11월 3일 14:05');
    expect(body.match(/2026\.11\.03 14:05/g)).toHaveLength(1);
    // 난이도 배지는 제목 옆으로 옮긴다
    expect(body).toContain('song-level-hard');
    expect(body).not.toContain('rec-list-song');
    expect(body).toContain('악보 연습');
    // 메뉴 라벨은 저장된 제목 그대로
    expect(body).toContain('aria-label="곡 제목 · 11월 3일 14:05 메뉴"');
  });

  it('자유 연습 기본 제목은 "자유 연습"을 한 번만 보인다', () => {
    const html = render({ items: [summary({ title: defaultRecordingTitle(null, new Date(2026, 10, 3, 14, 5)) })], total: 1 });
    const body = html.slice(html.indexOf('aria-label="녹음 보관함"'), html.indexOf('rec-playbar'));
    expect(body.match(/자유 연습/g)).toHaveLength(1);
    expect(body.match(/2026\.11\.03 14:05/g)).toHaveLength(1);
  });

  it('알 수 없는 난이도면 배지 없이 곡 제목만', () => {
    const html = render({ items: [summary({ song: { songId: 7, title: '곡 제목', difficulty: 'WEIRD' } })], total: 1 });
    expect(html).toContain('곡 제목');
    expect(html).not.toContain('song-level');
  });

  // ---- 재생바: 라이브러리 목록 줄의 곡 재생바와 같은 모양(조작부 + 막대 아래 양끝 시간) ----
  it('쉬는 행: ▶만 눌리고(10초 버튼 없음) 빈 막대와 「0:00 · -길이」를 보인다', () => {
    const html = render({ items: [summary()], total: 1 });
    expect(html).toContain('data-phase="idle"');
    expect(html).toContain('rec-playbar-track');
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain('10초 뒤로');
    expect(html).not.toContain('10초 앞으로');
    expect(html).toContain('>0:00<');
    expect(html).toContain('>-1:23<');
  });

  it('재생 중 행: 10초 뒤로·일시정지·10초 앞으로와 끌어서 옮기는 막대(양끝에 경과·남은 시간)', () => {
    const html = render({ items: [summary(), summary({ id: 2, title: '다른 녹음' })], total: 2, playingId: 1, positionMs: 33_360 });
    expect(html.match(/rec-list-row playing/g)).toHaveLength(1);
    expect(html).toContain('data-phase="playing"');
    expect(html).toContain('aria-label="「내 연주」 녹음 일시정지"');
    expect(html).not.toContain('aria-label="「내 연주」 녹음 재생"');
    expect(html.match(/aria-label="10초 뒤로"/g)).toHaveLength(1);
    expect(html.match(/aria-label="10초 앞으로"/g)).toHaveLength(1);
    // 공용 SeekBar의 ends 배치: range 입력 하나, 막대 아래 양끝 시간
    expect(html).not.toContain('role="progressbar"');
    expect(html.match(/type="range"/g)).toHaveLength(1);
    expect(html).toContain('free-seek is-ends');
    expect(html).toContain('aria-label="녹음 위치"');
    expect(html).toContain('max="83400"');
    expect(html).toContain('value="33360"');
    expect(html).toContain('>0:33<');
    expect(html).toContain('>-0:50<');
    // 다른 행은 쉬는 상태
    expect(html).toContain('aria-label="「다른 녹음」 녹음 재생"');
  });

  it('일시정지한 행: 막대는 그 위치에 남고 가운데 버튼은 다시 「재생」', () => {
    const html = render({ items: [summary()], total: 1, playingId: 1, paused: true, positionMs: 33_360 });
    expect(html.match(/rec-list-row playing/g)).toHaveLength(1);
    expect(html).toContain('data-phase="paused"');
    expect(html).toContain('aria-label="「내 연주」 녹음 재생"');
    expect(html).not.toContain('녹음 일시정지');
    expect(html).toContain('value="33360"');
    expect(html).toContain('aria-label="10초 뒤로"');
  });

  it('타격이 없는 녹음은 「타격 없음」 칩을 붙인다', () => {
    expect(render({ items: [summary({ hitCount: 0 })], total: 1 })).toContain('>타격 없음<');
  });

  it('상세를 받는 중인 행: 쉬는 모양 그대로 두고(시간 글자 유지) 바쁨만 알린다 — 짧은 로딩에 깜빡이지 않게', () => {
    const html = render({ items: [summary()], total: 1, loadingId: 1 });
    expect(html).toContain('data-phase="loading"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('>0:00<');
    expect(html).toContain('>-1:23<');
    expect(html).not.toContain('불러오는 중');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('type="range"');
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
