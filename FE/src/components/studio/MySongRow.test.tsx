import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { SongSummary } from '@/domain/songCatalog';
import { dateLabel } from './dateLabel';
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
  difficulties: [],
  createdAt: '2026-10-29T01:00:00Z',
  coverUrl: null,
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
function card(s: SongSummary, justDone = false): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MySongCard song={s} justDone={justDone} onReupload={noop} onEdit={noop} />
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

  it('실패 행에 아티스트가 없으면 사유만', () => {
    expect(row(song({ status: 'FAILED', artist: '' }))).toContain('<span class="studio-row-sub">채보를 만들지 못했어요</span>');
  });

  it('처리 중 행: 「처리 중」 글자만, 동작 버튼과 ⋯ 메뉴 없음', () => {
    const html = row(song({ status: 'PROCESSING' }));
    expect(html).toContain('studio-row-stage');
    expect(html).toContain('처리 중');
    expect(html).not.toContain('ui-btn');
    expect(html).not.toContain('song-menu');
    expect(html).toContain('studio-badge-active');
  });

  it('⋯ 메뉴는 onEdit이 있을 때만(완료·실패 행)', () => {
    expect(row(song())).toContain('aria-label="별빛 산책 메뉴"');
    expect(row(song({ status: 'FAILED' }))).toContain('song-menu');
    expect(row(song(), false, false)).not.toContain('song-menu');
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
  it('완료 카드 [악보 연습]은 secondary sm 전체 폭 링크, ▶는 같은 곡 리듬 게임 링크', () => {
    const html = card(song());
    expect(html).toMatch(/class="ui-btn ui-btn-secondary ui-btn-sm ui-btn-full" href="\/sheet\?scope=MINE&amp;song=7"[^>]*>악보 연습/);
    expect(html).toMatch(/class="song-card-play"[^>]*>\s*<svg/);
    expect(html).not.toContain('다시 올리기');
  });

  it('실패 카드: failed 클래스, 사유 줄, [다시 올리기] secondary sm 전체 폭', () => {
    const html = card(song({ status: 'FAILED' }));
    expect(html).toContain('studio-card failed');
    expect(html).toContain('<p class="studio-card-reason">채보를 만들지 못했어요</p>');
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
    expect(html).toContain('ui-icon-btn ui-icon-btn-sm song-menu-btn');
    expect(html).toContain('studio-card-menu');
  });

  it('MIDI 곡은 MIDI 칩, 음원 곡은 칩 없음', () => {
    expect(card(song())).toContain('studio-chip">MIDI');
    expect(card(song({ source: 'AUDIO' }))).not.toContain('studio-chip');
  });
});
