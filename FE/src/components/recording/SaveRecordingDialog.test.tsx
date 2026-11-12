import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRecordingForTest, useRecordingStore, type PendingRecording } from '@/runtime/recordingStore';
import { SaveRecordingDialog } from './SaveRecordingDialog';

// renderToStaticMarkup은 zustand의 서버 스냅샷(초기 상태)을 읽으므로, 훅이 현재 상태를 읽도록 바꾼다
vi.mock('@/runtime/recordingStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/runtime/recordingStore')>();
  const hook = <T,>(sel: (s: ReturnType<typeof actual.useRecordingStore.getState>) => T) => sel(actual.useRecordingStore.getState());
  return { ...actual, useRecordingStore: Object.assign(hook, actual.useRecordingStore) };
});

beforeEach(() => resetRecordingForTest());

const pending: PendingRecording = {
  mode: 'FREE',
  defaultTitle: '자유 연습 · 11월 4일 14:05',
  songTitle: null,
  hits: [
    { tMs: 100, pad: 'SNARE', velocity: 100 },
    { tMs: 65_400, pad: 'KICK', velocity: 90 },
  ],
  hasSensor: false,
  startedAt: new Date(2026, 10, 4, 14, 5),
  baseDurationMs: 60_000,
  clientKey: 'k1',
  playId: null,
  body: null,
};

const render = () => renderToStaticMarkup(<SaveRecordingDialog />);

describe('SaveRecordingDialog', () => {
  it('idle이면 아무것도 그리지 않는다', () => {
    expect(render()).toBe('');
  });

  it('pendingSave: 기본 제목·버튼·요약·안내', () => {
    useRecordingStore.setState({ phase: 'pendingSave', pending });
    const html = render();
    expect(html).toContain('녹음 저장');
    expect(html).toContain('value="자유 연습 · 11월 4일 14:05"');
    expect(html).toContain('maxLength="100"');
    expect(html).toContain('버리기');
    expect(html).toContain('>저장</button>');
    expect(html).toContain('type="submit"');
    expect(html).toContain('자유 연습 · 1:05 · 타격 2개');
    expect(html).toContain('비워 두면 기본 제목으로 저장해요 · 최대 100자');
    expect(html).not.toContain('최대 길이에 닿아');
    expect(html).not.toContain('role="alert"');
  });

  it('stopReason이 limit이면 상한 문구', () => {
    useRecordingStore.setState({ phase: 'pendingSave', pending, stopReason: 'limit' });
    expect(render()).toContain('최대 길이에 닿아 녹음을 멈췄어요');
  });

  it('saving: 입력·버튼 disabled, 저장 중…', () => {
    useRecordingStore.setState({ phase: 'saving', pending });
    const html = render();
    expect(html).toContain('저장 중…');
    expect(html.match(/disabled=""/g)?.length).toBe(3);
  });

  it('failed·retryable: 버리기·다시 시도와 오류 알림', () => {
    useRecordingStore.setState({
      phase: 'failed',
      pending,
      error: { message: '연결이 불안정해요', retryable: true, kind: 'network' } as never,
    });
    const html = render();
    expect(html).toContain('버리기');
    expect(html).toContain('다시 시도');
    expect(html).toContain('role="alert"');
    expect(html).toContain('연결이 불안정해요');
    expect(html).not.toContain('>저장</button>');
  });

  it('failed·재시도 불가: 닫기만', () => {
    useRecordingStore.setState({
      phase: 'failed',
      pending,
      error: { message: '녹음이 너무 길어 저장하지 못했어요', retryable: false, kind: 'tooLarge' } as never,
    });
    const html = render();
    expect(html).toContain('닫기');
    expect(html).not.toContain('버리기');
    expect(html).not.toContain('다시 시도');
    expect(html).toContain('role="alert"');
  });
});
