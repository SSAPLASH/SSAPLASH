// @vitest-environment happy-dom
// 플레이 기록 행 (설계 COACH-연주-기록-화면-개편, 시안 v7)
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayLogRow } from './PlayLogRow';
import type { PlayRowView } from './playLogRows';

const row = (over: Partial<PlayRowView> = {}): PlayRowView => ({
  playId: 'p1', title: '별빛 산책', titleMuted: false, mode: 'RHYTHM', level: 'HARD', at: new Date(2026, 10, 12, 14, 31).toISOString(), durationMs: 192000,
  accuracy: 74.1, score: 141250, wideGoodMs: null, rate: null, chips: [], save: null, link: { kind: 'REPORT', to: '/result/p1/report' }, ...over,
});
const show = (r: PlayRowView, onRetry = vi.fn()) => {
  render(
    <MemoryRouter>
      <ul>
        <PlayLogRow row={r} onRetry={onRetry} />
      </ul>
    </MemoryRouter>,
  );
  return onRetry;
};

afterEach(cleanup);

describe('PlayLogRow', () => {
  it('제목·난이도·모드·시각·길이와 정확도·점수를 보인다. 왼쪽 모드 그림은 없다', () => {
    show(row());
    const item = screen.getByRole('listitem');
    expect(item.querySelector('.history-row-title')?.textContent).toBe('별빛 산책');
    expect(item.querySelector('.song-level-hard')).not.toBeNull();
    expect(item.querySelector('.history-row-sub')?.textContent).toBe('리듬 게임오후 2:313:12');
    expect(screen.getByLabelText('정확도 74.1%, 점수 141,250')).toBeTruthy();
    expect(item.querySelector('svg.history-mode-icon')).toBeNull();
  });

  it('넓혀 연주한 판은 보조 줄에 「판정 여유 ±Nms」를 보이고, 아니면 없다', () => {
    show(row({ wideGoodMs: 90 }));
    expect(screen.getByText('판정 여유 ±90ms')).toBeTruthy();
    cleanup();
    show(row({ wideGoodMs: null }));
    expect(screen.queryByText(/판정 여유/)).toBeNull();
  });

  it('정확도 막대는 판정 색 단계를 따른다: 90 이상 perfect, 70 이상 good, 그 아래 miss', () => {
    const tier = (accuracy: number) => {
      cleanup();
      show(row({ accuracy }));
      return screen.getByRole('listitem').querySelector('.history-bar-fill')?.className;
    };
    expect(tier(93.4)).toContain('is-perfect');
    expect(tier(89.9)).toContain('is-good');
    expect(tier(70)).toContain('is-good');
    expect(tier(62.5)).toContain('is-miss');
    expect((screen.getByRole('listitem').querySelector('.history-bar-fill') as HTMLElement).style.width).toBe('62.5%');
  });

  it('악보 연습은 점수 없이 정확도만, 정확도가 없으면 「—」와 빈 막대', () => {
    show(row({ mode: 'SHEET', score: null, accuracy: 81.25 }));
    expect(screen.getByLabelText('정확도 81.3%')).toBeTruthy();
    cleanup();
    show(row({ accuracy: null, score: null }));
    expect(screen.getByLabelText('정확도 없음').textContent).toContain('—');
    expect(screen.getByRole('listitem').querySelector('.history-bar-fill')).toBeNull();
  });

  it('행은 누르는 곳이 아니고 「리포트」 글자 링크만 리포트로 간다', () => {
    show(row());
    const link = screen.getByRole('link', { name: '별빛 산책 리포트 보기' });
    expect(link.getAttribute('href')).toBe('/result/p1/report');
    expect(link.textContent).toBe('리포트');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('리포트도 결과도 없으면 「리포트 없음」만 보인다', () => {
    show(row({ link: null }));
    expect(screen.getByText('리포트 없음')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('칩: 중단·삭제된 곡·이용할 수 없는 곡, 흐린 제목', () => {
    show(row({ chips: ['ABORTED', 'UNAVAILABLE'], titleMuted: true }));
    expect(screen.getByText('중단')).toBeTruthy();
    expect(screen.getByText('이용할 수 없는 곡')).toBeTruthy();
    expect(screen.getByRole('listitem').querySelector('.history-row-title')?.className).toContain('is-muted');
    cleanup();
    show(row({ chips: ['DELETED'] }));
    expect(screen.getByText('삭제된 곡')).toBeTruthy();
  });

  it('저장 중: 상태와 결과 링크', () => {
    show(row({ save: 'SAVING', link: { kind: 'RESULT', to: '/result/p1' } }));
    expect(screen.getByRole('status').textContent).toBe('저장 중…');
    expect(screen.getByRole('link', { name: '별빛 산책 결과 보기' }).getAttribute('href')).toBe('/result/p1');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('저장 실패: [다시 시도]가 그 기록의 재전송을 부른다', () => {
    const onRetry = show(row({ save: 'FAILED', link: { kind: 'RESULT', to: '/result/p1' } }));
    expect(screen.getByText('저장 실패')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledWith('p1');
    expect(screen.getByRole('link', { name: '별빛 산책 결과 보기' })).toBeTruthy();
  });

  it('저장 안 됨: 다시 시도 없이 상태만', () => {
    show(row({ save: 'UNSAVED', link: { kind: 'RESULT', to: '/result/p1' } }));
    expect(screen.getByText('저장 안 됨')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('연습 속도로 친 판은 보조 줄에 「70% 속도」를 보이고, 원래 빠르기면 없다', () => {
    show(row({ rate: 0.7 }));
    expect(screen.getByText('70% 속도')).toBeTruthy();
    cleanup();
    show(row({ rate: null }));
    expect(screen.queryByText(/% 속도/)).toBeNull();
  });
});
