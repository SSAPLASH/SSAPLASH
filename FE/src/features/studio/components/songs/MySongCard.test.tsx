import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { SongSummary } from '@/domain/song/songCatalog';
import { MySongCard } from './MySongCard';
import { MySongRow } from './MySongRow';
import { SongDeleteDialog } from './SongDeleteDialog';
import { StudioToast } from '@/features/studio/components/StudioToast';

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
  accompanimentStatus: 'NONE',
  songLevel: null,
  difficulties: [],
  createdAt: '2026-10-29T01:00:00Z',
  coverUrl: null,
  sheetId: null,
  ...over,
});

function card(s: SongSummary, withEdit = true): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MySongCard song={s} justDone={false} onReupload={() => {}} onEdit={withEdit ? () => {} : undefined} />
    </MemoryRouter>,
  );
}

describe('MySongCard (v0.4)', () => {
  it('아티스트가 없으면 「알 수 없음」', () => {
    expect(card(song({ artist: '' }))).toContain('<span class="studio-card-artist">알 수 없음</span>');
  });

  it('출처 칩: MIDI는 「MIDI」, MusicXML 악보 곡은 「MusicXML」, 음원 곡은 없음(293)', () => {
    expect(card(song({ source: 'MIDI' }))).toContain('class="studio-chip">MIDI<');
    expect(card(song({ source: 'MUSICXML' }))).toContain('class="studio-chip">MusicXML<');
    expect(card(song({ source: 'AUDIO' }))).not.toContain('class="studio-chip">');
  });

  it('완료 곡: [▶ 플레이] 하나(곡 제목 라벨, 메뉴 트리거)만 있고 커버 ▶ 링크·[악보 연습] 링크는 없다', () => {
    const html = card(song());
    expect(html).toContain('aria-label="「별빛 산책」 플레이"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('class="song-card-play"');
    expect(html).not.toContain('href="/play?');
    expect(html).not.toContain('href="/sheet?');
    expect(html).not.toContain('악보 연습');
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

  it('실패 곡: [플레이] 없음, 사유 한 줄과 [다시 올리기], ⋯ 메뉴 있음', () => {
    const html = card(song({ status: 'FAILED' }));
    expect(html).not.toContain('플레이');
    expect(html).toContain('다시 올리기');
    expect(html).toContain('채보를 만들지 못했어요');
    expect(html).toContain('aria-label="별빛 산책 메뉴"');
  });

  it('처리 중 곡: [플레이]·⋯ 메뉴 없음', () => {
    const html = card(song({ status: 'PROCESSING' }));
    expect(html).not.toContain('플레이');
    expect(html).not.toContain('ui-more-menu');
  });

  it('기능 스위치 꺼짐(onEdit 없음)이면 ⋯ 메뉴가 없다', () => {
    expect(card(song(), false)).not.toContain('ui-more-menu');
  });
});

describe('MySongRow 완료 행', () => {
  it('[악보 연습]·[플레이] 버튼을 둔다(Figma SongListRow)', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MySongRow song={song()} justDone={false} onReupload={() => {}} />
      </MemoryRouter>,
    );
    expect(html).toContain('악보 연습');
    expect(html).toContain('플레이');
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
    expect(busy).toMatch(/aria-label="닫기"[^>]*disabled=""/);
  });
});

describe('StudioToast', () => {
  it('문구가 있으면 보이고 없으면 빈 알림 영역만 둔다', () => {
    expect(renderToStaticMarkup(<StudioToast text="「곡」을 삭제했습니다." />)).toContain('「곡」을 삭제했습니다.');
    expect(renderToStaticMarkup(<StudioToast text={null} />)).not.toContain('studio-toast"');
  });
});

describe('반주 배지 (CHART-002 반주 상태)', () => {
  it('완료 곡의 반주 생성 중·실패는 배지를 붙인다', () => {
    const gen = card(song({ accompanimentStatus: 'GENERATING' }));
    expect(gen).toContain('반주 생성 중');
    expect(gen).toContain('studio-badge-active');
    const failed = card(song({ accompanimentStatus: 'FAILED' }));
    expect(failed).toContain('반주 생성 실패');
    expect(failed).toContain('studio-badge-danger');
  });

  it('반주 READY·NONE이면 배지가 없다', () => {
    expect(card(song({ accompanimentStatus: 'READY' }))).not.toContain('반주 생성');
    expect(card(song({ accompanimentStatus: 'NONE' }))).not.toContain('반주 생성');
  });

  it('채보 생성 중·실패 곡에는 반주 배지를 붙이지 않는다', () => {
    expect(card(song({ status: 'PROCESSING', accompanimentStatus: 'GENERATING' }))).not.toContain('반주 생성');
    expect(card(song({ status: 'FAILED', accompanimentStatus: 'FAILED' }))).not.toContain('반주 생성');
  });
});
