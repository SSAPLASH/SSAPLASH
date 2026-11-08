// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongSummary } from '@/domain/songCatalog';
import { SongDetailPane } from './SongDetailPane';

const song = (id: number, title: string): SongSummary => ({
  id, title, artist: '가수', source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 60000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: 'BEGINNER', difficulties: ['EASY'], createdAt: '', coverUrl: null, sheetId: null,
});

afterEach(cleanup);

describe('SongDetailPane [이 곡 보기]', () => {
  it('누르면 onSimilarPick을 한 번 부르고 [준비]는 부르지 않는다', () => {
    const onSimilarPick = vi.fn();
    const onPrepare = vi.fn();
    render(
      <SongDetailPane
        song={song(1, '기준곡')}
        presetName={null}
        chartState="ready"
        onRetry={() => {}}
        onPrepare={onPrepare}
        similar={{ song: song(2, '비슷한곡'), chartId: 20, difficulty: 'NORMAL', line: '' }}
        onSimilarPick={onSimilarPick}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '이 곡 보기' }));
    expect(onSimilarPick).toHaveBeenCalledTimes(1);
    expect(onPrepare).not.toHaveBeenCalled();
  });
});
