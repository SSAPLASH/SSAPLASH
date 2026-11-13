import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { songFromDto, type SongSummary } from '@/domain/song/songCatalog';
import { dateLabel } from '@/features/studio/components/dateLabel';
import { MySongCard } from './MySongCard';
import { MySongRow } from './MySongRow';

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

const noop = () => {};

function row(s: SongSummary, justDone = false, withEdit = true): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MySongRow song={s} justDone={justDone} onReupload={noop} onEdit={withEdit ? noop : undefined} />
    </MemoryRouter>,
  );
}
function card(s: SongSummary, justDone = false, onSheet?: () => void): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MySongCard song={s} justDone={justDone} onReupload={noop} onEdit={noop} onSheet={onSheet} />
    </MemoryRouter>,
  );
}

describe('MySongRow', () => {
  it('완료 행: [악보 연습] secondary sm 링크, [플레이] primary sm 링크 두 개', () => {
    const html = row(song());
    expect(html).toMatch(/<a class="ui-btn ui-btn-secondary ui-btn-sm" href="\/sheet\?scope=MINE&amp;song=7"[^>]*>악보 연습<\/a>/);
    expect(html).toMatch(/<a class="ui-btn ui-btn-primary ui-btn-sm" href="\/play\?scope=MINE&amp;song=7"[^>]*>플레이<\/a>/);
    expect(html).toContain('studio-badge-ok');
    expect(html).not.toContain('다시 올리기');
  });

  it('실패 행: [다시 올리기] secondary sm 하나, 보조 줄에 아티스트와 사유, failed 클래스', () => {
    const html = row(song({ status: 'FAILED' }));
    expect(html).toContain('studio-row failed');
    expect(html).toMatch(/ui-btn ui-btn-secondary ui-btn-sm[^>]*>다시 올리기/);
    expect(html).toContain('파란물결 · 채보를 만들지 못했어요');
    expect(html).not.toContain('악보 연습');
    expect(html).not.toContain('>플레이<');
    expect(html).toContain('studio-badge-danger');
  });

  it('실패 행에 아티스트가 없으면 「알 수 없음」과 사유', () => {
    expect(row(song({ status: 'FAILED', artist: '' }))).toContain('<span class="studio-row-sub">알 수 없음 · 채보를 만들지 못했어요</span>');
  });

  it('아티스트가 없으면 「알 수 없음」', () => {
    expect(row(song({ artist: '' }))).toContain('<span class="studio-row-sub">알 수 없음</span>');
  });

  it('처리 중 행: 「처리 중」 글자만, 동작 버튼과 ⋯ 메뉴 없음', () => {
    const html = row(song({ status: 'PROCESSING' }));
    expect(html).toContain('studio-row-stage');
    expect(html).toContain('처리 중');
    expect(html).not.toContain('ui-btn');
    expect(html).not.toContain('ui-more-menu');
    expect(html).toContain('studio-badge-active');
  });

  it('⋯ 메뉴는 onEdit이 있을 때만(완료·실패 행)', () => {
    expect(row(song())).toContain('aria-label="별빛 산책 메뉴"');
    expect(row(song({ status: 'FAILED' }))).toContain('ui-more-menu');
    expect(row(song(), false, false)).not.toContain('ui-more-menu');
  });

  it('날짜 칸은 dateLabel 결과', () => {
    const iso = new Date(Date.now() - 2 * 3600_000 - 60_000).toISOString();
    const html = row(song({ createdAt: iso }));
    const label = dateLabel(iso);
    expect(label).not.toBe('');
    expect(html).toContain(`<span class="studio-row-date">${label}</span>`);
  });

  it('방금 완료(justDone)면 just-done 클래스', () => {
    expect(row(song(), true)).toContain('studio-row just-done');
    expect(row(song(), false)).not.toContain('just-done');
  });
});

describe('MySongCard 보강', () => {
  it('완료 카드 맨 아래는 악보가 있으면 secondary sm 전체 폭 [악보 보기] 링크, 커버 ▶·[악보 연습] 링크는 없다', () => {
    const html = card(song({ sheetId: 4 }), false, noop);
    expect(html).toMatch(/class="ui-btn ui-btn-secondary ui-btn-sm ui-btn-full" href="\/studio\/sheets\/4"[^>]*>악보 보기/);
    expect(html).not.toContain('class="song-card-play"');
    expect(html).not.toContain('악보 연습');
    expect(html).not.toContain('다시 올리기');
  });

  it('실패 카드: failed 클래스, 사유 줄, [다시 올리기] secondary sm 전체 폭', () => {
    const html = card(song({ status: 'FAILED' }));
    expect(html).toContain('studio-card failed');
    expect(html).toContain('<span class="studio-card-reason">채보를 만들지 못했어요</span>');
    expect(html).toMatch(/ui-btn ui-btn-secondary ui-btn-sm ui-btn-full[^>]*>다시 올리기/);
    expect(html).not.toContain('악보 연습');
  });

  it('상태 클래스: 완료 곡은 failed 없음, justDone이면 just-done', () => {
    expect(card(song())).not.toContain('failed');
    expect(card(song(), true)).toContain('studio-card just-done');
    expect(card(song({ status: 'FAILED' }), true)).toContain('studio-card failed just-done');
  });

  it('⋯ 메뉴 트리거는 IconButton sm', () => {
    const html = card(song());
    expect(html).toContain('ui-icon-btn ui-icon-btn-sm ui-more-menu-btn');
    expect(html).toContain('studio-card-menu');
  });

  it('MIDI 곡은 MIDI 칩, 음원 곡은 칩 없음', () => {
    expect(card(song())).toContain('studio-chip">MIDI');
    expect(card(song({ source: 'AUDIO' }))).not.toContain('studio-chip');
  });
});

describe('반주 배지 (CHART-002 반주 상태)', () => {
  it('완료 행의 반주 생성 중·실패만 배지를 붙인다', () => {
    expect(row(song({ accompanimentStatus: 'GENERATING' }))).toContain('반주 생성 중');
    expect(row(song({ accompanimentStatus: 'FAILED' }))).toContain('반주 생성 실패');
    expect(row(song({ accompanimentStatus: 'READY' }))).not.toContain('반주 생성');
    expect(row(song({ status: 'PROCESSING', accompanimentStatus: 'GENERATING' }))).not.toContain('반주 생성');
  });
});


describe('채보 실패 사유 표시', () => {
  const messages = [
    ['INPUT_INVALID', '파일을 처리할 수 없어요'],
    ['OUTPUT_INVALID', '채보 결과를 처리하지 못했어요'],
    ['MODEL_FAILED', '채보 생성 중 오류가 발생했어요'],
    ['JOB_CANCELLED', '채보 생성이 취소됐어요'],
    ['JOB_FAILED', '채보 작업을 완료하지 못했어요'],
  ] as const;

  it.each(messages)('%s 코드를 카드와 행의 문구로 표시한다', (code, message) => {
    const failedSong = song({ status: 'FAILED', chartFailure: { code } });
    expect(card(failedSong)).toContain(`<span class="studio-card-reason">${message}</span>`);
    expect(row(failedSong)).toContain(`파란물결 · ${message}`);
  });

  it('없는 코드, 빈 코드, 모르는 코드와 프로토타입 키에는 기본 문구를 쓴다', () => {
    for (const chartFailure of [undefined, null, { code: '' }, { code: 'UNKNOWN_SECRET' }, { code: '__proto__' }]) {
      const failedSong = song({ status: 'FAILED', chartFailure });
      for (const html of [card(failedSong), row(failedSong)]) {
        expect(html).toContain('채보를 만들지 못했어요');
        expect(html).not.toContain('UNKNOWN_SECRET');
        expect(html).not.toContain('__proto__');
      }
    }
  });

  it('서버 메시지를 카드와 행에 노출하지 않는다', () => {
    const item = songFromDto({ id: 7, title: '곡', source: 'AUDIO', status: 'FAILED', chartFailure: { code: 'UNKNOWN_SECRET', message: 'internal details' } });
    for (const html of [card(item), row(item)]) {
      expect(html).toContain('채보를 만들지 못했어요');
      expect(html).not.toContain('UNKNOWN_SECRET');
      expect(html).not.toContain('internal details');
    }
  });

  it('완료와 처리 중 곡에는 실패 사유를 표시하지 않는다', () => {
    for (const status of ['READY', 'PROCESSING']) {
      const item = song({ status, chartFailure: { code: 'INPUT_INVALID' } });
      expect(card(item)).not.toContain('파일을 처리할 수 없어요');
      expect(row(item)).not.toContain('파일을 처리할 수 없어요');
    }
  });
});
