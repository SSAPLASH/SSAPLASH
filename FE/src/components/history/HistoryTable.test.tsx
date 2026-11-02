import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { HistoryTable } from './HistoryTable';
import { DeletedSongChip } from '@/components/song/DeletedSongChip';
import { DELETED_SONG_LABEL } from '@/domain/songAvailability';
import type { PlayLog } from '@/engine/playLog';

function log(over: Partial<PlayLog> & { playId: string }): PlayLog {
  return {
    songId: 's',
    title: '곡 제목',
    difficulty: 'EASY',
    mode: 'RHYTHM',
    inputSource: 'STICK',
    startedAt: new Date(2026, 10, 1, 9, 5).toISOString(),
    durationMs: 1000,
    timing: { perfectMs: 25, goodMs: 60 },
    calibrationId: null,
    chartVersionId: null,
    songNumericId: null,
    chartId: null,
    presetId: null,
    bpm: 120,
    beatsPerBar: 4,
    hits: [],
    notes: [],
    summary: { score: 92400, maxScore: 100000, accuracy: 0.968, maxCombo: 10, counts: { PERFECT: 1, GOOD: 0, MISS: 0 }, strayHits: 0 },
    ...over,
  } as PlayLog;
}

const render = (logs: PlayLog[], deleted: number[] = []) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <HistoryTable logs={logs} deletedIds={new Set(deleted)} />
    </MemoryRouter>,
  );

describe('HistoryTable', () => {
  it('로그 수만큼 본문 행을 그린다', () => {
    const html = render([log({ playId: 'a' }), log({ playId: 'b' }), log({ playId: 'c' })]);
    const body = html.slice(html.indexOf('<tbody'));
    expect(body.match(/<tr/g)).toHaveLength(3);
  });

  it('로그가 없으면 본문 행도 없다', () => {
    const html = render([]);
    expect(html.slice(html.indexOf('<tbody')).match(/<tr/g)).toBeNull();
  });

  it('열 머리글 5개(날짜·모드·곡·정확도 / 점수·결과 보기)', () => {
    const html = render([]);
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(head.match(/<th /g)).toHaveLength(5);
    expect(head).toContain('정확도 / 점수');
  });

  it('게임 행은 「정확도 / 점수」 표기, 날짜·모드 표기', () => {
    const html = render([log({ playId: 'a' })]);
    expect(html).toContain('96.8% / 92,400');
    expect(html).toContain('2026.11.01 09:05');
    expect(html).toContain('>게임<');
  });

  it('악보 행은 점수 자리가 「—」', () => {
    const html = render([log({ playId: 'a', mode: 'SHEET' })]);
    expect(html).toContain('96.8% / —');
    expect(html).toContain('>악보<');
  });

  it('삭제된 곡 행에 칩과 흐림 클래스', () => {
    const html = render([log({ playId: 'a', songNumericId: 7 })], [7]);
    expect(html).toContain(DELETED_SONG_LABEL);
    expect(html).toContain('song-deleted-chip');
    expect(html).toContain('history-song-title deleted');
  });

  it('삭제되지 않았거나 내장 채보(songNumericId null) 행에는 칩이 없다', () => {
    const html = render([log({ playId: 'a', songNumericId: 7 }), log({ playId: 'b', songNumericId: null })], [8]);
    expect(html).not.toContain('song-deleted-chip');
    expect(html).not.toContain('history-song-title deleted');
  });

  it('결과 보기 링크는 /result/{playId}', () => {
    const html = render([log({ playId: 'abc-1' }), log({ playId: 'xyz-2' })]);
    expect(html).toContain('href="/result/abc-1"');
    expect(html).toContain('href="/result/xyz-2"');
    expect(html.match(/>결과 보기</g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('삭제된 곡도 결과 보기 링크는 그대로 열린다', () => {
    expect(render([log({ playId: 'gone', songNumericId: 3 })], [3])).toContain('href="/result/gone"');
  });
});

describe('DeletedSongChip', () => {
  it('문구는 DELETED_SONG_LABEL', () => {
    expect(renderToStaticMarkup(<DeletedSongChip />)).toContain(`>${DELETED_SONG_LABEL}<`);
    expect(DELETED_SONG_LABEL).toBe('삭제된 곡');
  });

  it('className을 합친다', () => {
    expect(renderToStaticMarkup(<DeletedSongChip className="x" />)).toContain('class="song-deleted-chip x"');
  });
});
