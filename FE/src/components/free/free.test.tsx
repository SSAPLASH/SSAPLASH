// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccompanimentBarView, AccompanimentPick } from '@/domain/freeAccompaniment';
import type { SongSummary } from '@/domain/songCatalog';
import { AccompanimentBar } from './AccompanimentBar';
import { AccompanimentPicker } from './AccompanimentPicker';
import { SeekBar } from './SeekBar';
import { DisconnectBand, type BandReconnect } from './DisconnectBand';

afterEach(cleanup);

const noop = () => {};
const idle: BandReconnect = { status: 'idle', attempt: 0, max: 3 };

const pickSong: AccompanimentPick = { songId: 1, title: '곡 제목', artist: '가수', coverUrl: null };
const viewOf = (p: Partial<AccompanimentBarView>): AccompanimentBarView => ({
  phase: 'none', pick: null, positionMs: 0, durationMs: 0, timeText: '0:00 / 0:00', errorText: null, seekable: false, ...p,
});
const NONE = viewOf({});
const PLAYING = viewOf({ phase: 'playing', pick: pickSong, positionMs: 72_000, durationMs: 204_000, timeText: '1:12 / 3:24', seekable: true });

describe('AccompanimentBar', () => {
  it('none 문구를 보여준다', () => {
    const html = renderToStaticMarkup(<AccompanimentBar view={NONE} />);
    expect(html).toContain('반주 없이 연습 중');
    expect(html).toContain('반주 고르기');
  });

  it('onPick이 없으면 비활성 + builtin 빌드 안내 title', () => {
    const html = renderToStaticMarkup(<AccompanimentBar view={NONE} />);
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('title="이 빌드에서는 반주를 쓸 수 없어요"');
  });

  it('onPick이 있으면 활성', () => {
    const html = renderToStaticMarkup(<AccompanimentBar view={NONE} onPick={noop} />);
    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect(html).not.toContain('쓸 수 없어요');
  });

  it('playing: 제목·보조 줄·일시정지·진행 막대·시간·바꾸기·끄기', () => {
    const html = renderToStaticMarkup(<AccompanimentBar view={PLAYING} onPick={noop} />);
    expect(html).toContain('곡 제목');
    expect(html).toContain('가수 · 드럼 뺀 반주');
    expect(html).toContain('aria-label="반주 일시정지"');
    expect(html).toContain('aria-label="반주 위치"');
    expect(html).toContain('1:12 / 3:24');
    expect(html).toContain('바꾸기');
    expect(html).toContain('끄기');
    expect(html).not.toContain('반주 없이 연습 중');
  });

  it('아티스트가 없으면 보조 줄은 「드럼 뺀 반주」만', () => {
    const html = renderToStaticMarkup(<AccompanimentBar view={{ ...PLAYING, pick: { ...pickSong, artist: null } }} />);
    expect(html).toContain('>드럼 뺀 반주<');
    expect(html).not.toContain(' · 드럼 뺀 반주');
  });

  it('paused: 재생 버튼과 진행 막대', () => {
    const html = renderToStaticMarkup(<AccompanimentBar view={{ ...PLAYING, phase: 'paused' }} />);
    expect(html).toContain('aria-label="반주 재생"');
    expect(html).not.toContain('반주 일시정지');
    expect(html).toContain('aria-label="반주 위치"');
  });

  it('loading: 불러오는 중 문구, 막대 숨김, 끄기만', () => {
    const html = renderToStaticMarkup(<AccompanimentBar view={viewOf({ phase: 'loading', pick: pickSong })} onPick={noop} />);
    expect(html).toContain('반주를 불러오는 중…');
    expect(html).not.toContain('반주 위치');
    expect(html).not.toContain('바꾸기');
    expect(html).toContain('끄기');
  });

  it('error: 오류 문구와 다시 시도·다른 곡·끄기', () => {
    const html = renderToStaticMarkup(
      <AccompanimentBar view={viewOf({ phase: 'error', pick: pickSong, errorText: '이 곡은 반주 파일이 없어요' })} onPick={noop} />,
    );
    expect(html).toContain('이 곡은 반주 파일이 없어요');
    expect(html).toContain('다시 시도');
    expect(html).toContain('다른 곡');
    expect(html).toContain('끄기');
    expect(html).not.toContain('반주 위치');
  });
});

describe('AccompanimentPicker', () => {
  const song = (id: number, acc: SongSummary['accompanimentStatus']): SongSummary => ({
    id, title: `곡${id}`, artist: '가수', source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 1000,
    hasAccompaniment: acc === 'READY', accompanimentStatus: acc, songLevel: null, difficulties: [], createdAt: '', coverUrl: null, sheetId: null,
  });
  const listSongs = async (p: { source: string }) =>
    p.source === 'BUILTIN' ? { items: [song(1, 'READY'), song(2, 'GENERATING'), song(3, 'NONE')], hasNext: true } : { items: [], hasNext: false };
  const renderPicker = (props: Partial<React.ComponentProps<typeof AccompanimentPicker>> = {}) =>
    render(
      <MemoryRouter>
        <AccompanimentPicker currentSongId={null} onPick={noop} onClose={noop} songsDeps={{ listSongs }} {...props} />
      </MemoryRouter>,
    );

  it('공용 곡·내 곡 섹션, 생성 중은 비활성+이유, 반주 없는 곡은 숨김, 더 보기·빈 문구', async () => {
    renderPicker();
    await screen.findByText('곡1');
    expect(screen.getByRole('region', { name: '공용 곡' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '내 곡' })).toBeTruthy();
    expect(screen.queryByText('곡3')).toBeNull();
    expect(screen.getByText('반주 만드는 중')).toBeTruthy();
    expect(screen.getByText('곡2').closest('button')?.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('더 보기')).toBeTruthy();
    expect(await screen.findByText(/반주가 있는 내 곡이 없어요/)).toBeTruthy();
  });

  it('곡을 누르면 고른 곡 정보로 onPick', async () => {
    const onPick = vi.fn();
    renderPicker({ onPick });
    fireEvent.click((await screen.findByText('곡1')).closest('button')!);
    expect(onPick).toHaveBeenCalledWith({ songId: 1, title: '곡1', artist: '가수', coverUrl: null });
  });

  it('지금 고른 곡은 「재생 중」, 다시 누르면 onPick 없이 닫기만', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    renderPicker({ currentSongId: 1, onPick, onClose });
    expect(await screen.findByText('재생 중')).toBeTruthy();
    fireEvent.click(screen.getByText('곡1').closest('button')!);
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('목록 실패는 섹션별 문구와 다시 시도, 다른 섹션은 그대로', async () => {
    renderPicker({
      songsDeps: {
        listSongs: async (p: { source: string }) => {
          if (p.source === 'MINE') throw new Error('x');
          return { items: [song(1, 'READY')], hasNext: false };
        },
      },
    });
    expect(await screen.findByText(/목록을 불러오지 못했어요/)).toBeTruthy();
    expect(screen.getByText('곡1')).toBeTruthy();
  });
});

describe('SeekBar layout="ends"', () => {
  it('시간을 막대 아래 양끝에 경과 · 남은 시간으로 둔다', () => {
    const { container } = render(<SeekBar layout="ends" positionMs={72_000} durationMs={204_000} onSeek={noop} />);
    expect(container.querySelector('.free-seek.is-ends')).toBeTruthy();
    expect(container.querySelector('.free-seek-time')).toBeNull();
    const ends = container.querySelectorAll('.free-seek-ends > span');
    expect([...ends].map((e) => e.textContent)).toEqual(['1:12', '-2:12']);
  });

  it('기본 배치는 그대로 「경과 / 전체」', () => {
    const { container } = render(<SeekBar positionMs={72_000} durationMs={204_000} onSeek={noop} />);
    expect(container.querySelector('.free-seek.is-ends')).toBeNull();
    expect(container.querySelector('.free-seek-time')?.textContent).toBe('1:12 / 3:24');
  });
});

describe('SeekBar', () => {
  const setup = (onSeek = vi.fn(), positionMs = 72_000) => {
    render(<SeekBar positionMs={positionMs} durationMs={204_000} onSeek={onSeek} />);
    return { onSeek, range: screen.getByLabelText('반주 위치') as HTMLInputElement };
  };

  it('aria-valuetext와 시간 글자', () => {
    const { range } = setup();
    expect(range.getAttribute('aria-valuetext')).toBe('1분 12초 / 3분 24초');
    expect(screen.getByText('1:12 / 3:24')).toBeTruthy();
  });

  it('←/→는 5초, Home은 처음, End는 끝(자르기는 호출자)', () => {
    const { onSeek, range } = setup();
    fireEvent.keyDown(range, { key: 'ArrowRight' });
    expect(onSeek).toHaveBeenLastCalledWith(77_000);
    fireEvent.keyDown(range, { key: 'ArrowLeft' });
    expect(onSeek).toHaveBeenLastCalledWith(67_000);
    fireEvent.keyDown(range, { key: 'Home' });
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(range, { key: 'End' });
    expect(onSeek).toHaveBeenLastCalledWith(204_000);
  });

  it('문자·숫자 키(드럼 연주 키)는 막대가 쓰지 않는다', () => {
    const { onSeek, range } = setup();
    for (const key of ['f', 'j', ' ', '1']) fireEvent.keyDown(range, { key });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('끄는 동안은 시간 글자만 따라가고 손을 떼면 onSeek 한 번', () => {
    const { onSeek, range } = setup();
    fireEvent.pointerDown(range);
    fireEvent.change(range, { target: { value: '100000' } });
    fireEvent.change(range, { target: { value: '120000' } });
    expect(onSeek).not.toHaveBeenCalled();
    expect(screen.getByText('2:00 / 3:24')).toBeTruthy();
    fireEvent.pointerUp(range);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(120_000);
  });
});

describe('DisconnectBand', () => {
  it('끊긴 손을 제목에 쓴다', () => {
    expect(renderToStaticMarkup(<DisconnectBand left={true} right={false} reconnect={idle} />)).toContain('오른손 스틱 연결이 끊겼어요');
    expect(renderToStaticMarkup(<DisconnectBand left={false} right={true} reconnect={idle} />)).toContain('왼손 스틱 연결이 끊겼어요');
  });

  it('role=status', () => {
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} />)).toContain('role="status"');
  });

  it('idle: 살아있는 손은 계속 칠 수 있다는 문구', () => {
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} />)).toContain('왼손은 계속 칠 수 있어요');
    expect(renderToStaticMarkup(<DisconnectBand left={false} right reconnect={idle} />)).toContain('오른손은 계속 칠 수 있어요');
  });

  it('trying: 시도 횟수 표시', () => {
    const html = renderToStaticMarkup(
      <DisconnectBand left right={false} reconnect={{ status: 'trying', attempt: 2, max: 3 }} onReconnect={noop} />,
    );
    expect(html).toContain('다시 연결하는 중');
    expect(html).toContain('(2/3)');
    expect(html).not.toContain('aria-disabled');
    expect(html).toContain('stick-spinner');
    expect(html).toContain('free-band-dot off pulse');
  });

  it('failed: hint를 문구 뒤에 보인다', () => {
    const html = renderToStaticMarkup(
      <DisconnectBand left right={false} reconnect={{ status: 'failed', attempt: 3, max: 3, hint: '동글을 뺐다 다시 꽂아 주세요' }} />,
    );
    expect(html).toContain('연결하지 못했어요. 동글을 뺐다 다시 꽂아 주세요');
  });

  it('reconnected: 「재연결 성공!」만, 버튼 없음', () => {
    const html = renderToStaticMarkup(
      <DisconnectBand left right={false} reconnect={{ status: 'reconnected', attempt: 0, max: 3 }} onReconnect={noop} />,
    );
    expect(html).toContain('재연결 성공!');
    expect(html).not.toContain('다시 연결');
    expect(html).not.toContain('free-band-dot off');
  });

  it('failed: 드럼 세팅 안내', () => {
    const html = renderToStaticMarkup(
      <DisconnectBand left right={false} reconnect={{ status: 'failed', attempt: 3, max: 3 }} />,
    );
    expect(html).toContain('연결하지 못했어요');
    expect(html).toContain('드럼 세팅');
  });

  it('onReconnect가 없으면 다시 연결 버튼이 없다', () => {
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} />)).not.toContain('다시 연결');
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} onReconnect={noop} />)).toContain('다시 연결');
  });
});

describe('DisconnectBand 페달', () => {
  const band = (p: { left: boolean; right: boolean; pedal?: boolean; reconnect?: BandReconnect }) =>
    renderToStaticMarkup(<DisconnectBand left={p.left} right={p.right} pedal={p.pedal} reconnect={p.reconnect ?? idle} />);

  // 인수 조건: pedal이 undefined면 P 점·"페달" 문구가 없다
  it('pedal이 없으면 P 점과 페달 문구가 없다', () => {
    const html = band({ left: true, right: false });
    expect(html).not.toContain('>P<');
    expect(html).not.toContain('페달');
  });

  // 인수 조건: 페달만 끊기면 "페달 연결이 끊겼어요", 부제는 "스틱은 계속 칠 수 있어요"
  it('손이 모두 연결이고 페달만 끊기면 페달 제목과 스틱 부제', () => {
    const html = band({ left: true, right: true, pedal: false });
    expect(html).toContain('페달 연결이 끊겼어요');
    expect(html).not.toContain('스틱·페달');
    expect(html).toContain('스틱은 계속 칠 수 있어요');
    expect(html).toContain('>P<');
    expect(html).toContain('free-band-dot off');
  });

  // 인수 조건: 손이 하나라도 끊기면 "스틱·페달 연결이 끊겼어요"
  it('손도 끊겼으면 스틱·페달 제목', () => {
    expect(band({ left: true, right: false, pedal: false })).toContain('스틱·페달 연결이 끊겼어요');
  });

  // 인수 조건: reconnected면 P 점 on, off 없음
  it('reconnected면 P 점도 on', () => {
    const html = band({ left: true, right: true, pedal: false, reconnect: { status: 'reconnected', attempt: 0, max: 3 } });
    expect(html.match(/free-band-dot on/g)).toHaveLength(3);
    expect(html).not.toContain('free-band-dot off');
  });
});
