import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { SongSummary } from '@/domain/songCatalog';
import { MySongCard } from './MySongCard';
import { MySongRow } from './MySongRow';
import { SongDeleteDialog } from './SongDeleteDialog';
import { StudioToast } from './StudioToast';

const song = (over: Partial<SongSummary> = {}): SongSummary => ({
  id: 7,
  title: '별빛 산책',
  artist: '파란물결',
  source: 'MIDI',
  status: 'READY',
  bpm: 120,
  timeSignature: '4/4',
  durationMs: 60000,
  hasAccompaniment: false,
  difficulties: [],
  createdAt: '2026-10-29T01:00:00Z',
  coverUrl: null,
  ...over,
});

function card(s: SongSummary, withEdit = true): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MySongCard song={s} job={null} progress={null} justDone={false} onReupload={() => {}} onEdit={withEdit ? () => {} : undefined} />
    </MemoryRouter>,
  );
}

describe('MySongCard (v0.4)', () => {
  it('완료 곡: 커버 ▶ 리듬 게임(곡 제목 라벨)과 [악보 연주] 하나, 카드 아래 [플레이] 버튼은 없다', () => {
    const html = card(song());
    expect(html).toContain('class="song-card-play"');
    expect(html).toContain('aria-label="「별빛 산책」 리듬 게임"');
    expect(html).toContain('href="/play?scope=MINE&amp;song=7"');
    expect(html).toContain('href="/sheet?scope=MINE&amp;song=7"');
    expect(html).toContain('악보 연주');
    expect(html).not.toContain('악보 확인');
    expect(html).not.toContain('btn-primary');
  });

  it('카드에 날짜를 두지 않는다', () => {
    const html = card(song({ createdAt: new Date(Date.now() - 60_000).toISOString() }));
    expect(html).not.toMatch(/분 전|시간 전|방금/);
  });

  it('커버가 없으면 모든 곡에 같은 CD 기본 커버, 올린 커버는 이미지', () => {
    const a = card(song({ title: '가' }));
    const b = card(song({ title: 'Zebra' }));
    expect(a).toContain('song-cover-disc');
    expect(b).toContain('song-cover-disc');
    expect(card(song({ coverUrl: 'https://x/c.jpg' }))).toContain('src="https://x/c.jpg"');
  });

  it('실패 곡: ▶ 없음, 사유 문장 없이 [다시 올리기]만, ⋯ 메뉴 있음', () => {
    const html = card(song({ status: 'FAILED' }));
    expect(html).not.toContain('song-card-play');
    expect(html).toContain('다시 올리기');
    expect(html).not.toContain('채보를 만들지 못했습니다');
    expect(html).toContain('aria-label="별빛 산책 메뉴"');
  });

  it('처리 중 곡: ▶·⋯ 메뉴 없음', () => {
    const html = card(song({ status: 'PROCESSING' }));
    expect(html).not.toContain('song-card-play');
    expect(html).not.toContain('song-menu');
  });

  it('기능 스위치 꺼짐(onEdit 없음)이면 ⋯ 메뉴가 없다', () => {
    expect(card(song(), false)).not.toContain('song-menu');
  });
});

describe('MySongRow 완료 행', () => {
  it('[악보 연주]·[리듬 게임]으로 카드 보기와 같은 이름을 쓴다', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MySongRow song={song()} job={null} progress={null} justDone={false} onReupload={() => {}} />
      </MemoryRouter>,
    );
    expect(html).toContain('악보 연주');
    expect(html).toContain('리듬 게임');
    expect(html).not.toContain('악보 확인');
  });
});

describe('SongDeleteDialog', () => {
  it('질문과 기록이 남는다는 안내, 삭제 중이면 버튼 문구가 바뀌고 ✕·취소가 막힌다', () => {
    const idle = renderToStaticMarkup(<SongDeleteDialog song={song()} busy={false} error={null} onDelete={() => {}} onClose={() => {}} />);
    expect(idle).toContain('「별빛 산책」을 삭제할까요?');
    expect(idle).toContain('채보·반주·커버가 함께 지워지고 되돌릴 수 없습니다. 연주 기록과 결과는 남아요.');
    expect(idle).toContain('btn-danger');

    const busy = renderToStaticMarkup(<SongDeleteDialog song={song()} busy error={null} onDelete={() => {}} onClose={() => {}} />);
    expect(busy).toContain('삭제 중…');
    expect(busy).toMatch(/aria-label="닫기" disabled=""/);
  });
});

describe('StudioToast', () => {
  it('문구가 있으면 보이고 없으면 빈 알림 영역만 둔다', () => {
    expect(renderToStaticMarkup(<StudioToast text="「곡」을 삭제했습니다." />)).toContain('「곡」을 삭제했습니다.');
    expect(renderToStaticMarkup(<StudioToast text={null} />)).not.toContain('studio-toast"');
  });
});
