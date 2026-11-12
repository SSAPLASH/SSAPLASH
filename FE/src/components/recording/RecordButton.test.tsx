import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRecordingForTest, useRecordingStore } from '@/runtime/recordingStore';
import { formatElapsed } from '@/domain/play/recordingView';
import { RecordButton } from './RecordButton';
import { recordButtonVisible } from './recordButtonRoute';

// renderToStaticMarkup은 zustand의 서버 스냅샷(초기 상태)을 읽으므로, 훅이 현재 상태를 읽도록 바꾼다
vi.mock('@/runtime/recordingStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/runtime/recordingStore')>();
  const hook = <T,>(sel: (s: ReturnType<typeof actual.useRecordingStore.getState>) => T) => sel(actual.useRecordingStore.getState());
  return { ...actual, useRecordingStore: Object.assign(hook, actual.useRecordingStore) };
});

beforeEach(() => resetRecordingForTest());

function render(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <RecordButton />
    </MemoryRouter>,
  );
}


describe('RecordButton 라우트', () => {
  it('/free·/sheet에서만 보인다(정확 일치). 리듬 게임(/play)은 녹음하지 않는다', () => {
    for (const p of ['/free', '/sheet']) {
      expect(recordButtonVisible(p)).toBe(true);
      expect(render(p)).toContain('rec-btn');
    }
    for (const p of ['/play', '/history', '/result', '/studio', '/settings', '/setup', '/free/x', '/playground', '/']) {
      expect(recordButtonVisible(p)).toBe(false);
      expect(render(p)).toBe('');
    }
  });
});

describe('RecordButton 변형', () => {
  it('자유 idle: 녹음 시작', () => {
    const html = render('/free');
    expect(html).toContain('class="rec-btn idle"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="녹음 시작"');
    expect(html).toContain('<span class="rec-btn-label">녹음</span>');
    expect(html).toContain('rec-dot');
    expect(html).not.toContain('disabled');
  });

  it('자유 recording: 경과 시간 문구와 녹음 정지', () => {
    const startPerfMs = performance.now() - 65_000;
    useRecordingStore.setState({ phase: 'recording', free: { startPerfMs, startedAt: new Date(), hitCount: 0 } });
    const html = render('/free');
    expect(html).toContain('class="rec-btn recording"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="녹음 정지"');
    expect(html).toContain(`녹음 중 · ${formatElapsed(65_000)}`);
  });

  it('악보 idle: 녹음 켜기', () => {
    const html = render('/sheet');
    expect(html).toContain('class="rec-btn idle"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="녹음 켜기"');
  });

  it('armed: 녹음 켬 / 녹음 끄기', () => {
    useRecordingStore.setState({ phase: 'armed' });
    const html = render('/sheet');
    expect(html).toContain('class="rec-btn armed"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="녹음 끄기"');
    expect(html).toContain('녹음 켬');
    expect(html).not.toContain('disabled');
  });

  it('locked-on: 연주 중 녹음 켠 채 잠김', () => {
    useRecordingStore.setState({ phase: 'armed', locked: true });
    const html = render('/sheet');
    expect(html).toContain('class="rec-btn locked-on"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="연주 중엔 녹음을 바꿀 수 없어요"');
    expect(html).toContain('<span class="rec-btn-label">녹음 중</span>');
    expect(html).toContain('disabled');
  });

  it('locked-off: 연주 중 녹음 끈 채 잠김', () => {
    useRecordingStore.setState({ phase: 'idle', locked: true });
    const html = render('/sheet');
    expect(html).toContain('class="rec-btn locked-off"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="연주 중엔 녹음을 바꿀 수 없어요"');
    expect(html).toContain('<span class="rec-btn-label">녹음</span>');
    expect(html).toContain('disabled');
  });

  it.each(['pendingSave', 'saving', 'failed'] as const)('저장 창이 열린 단계(%s)는 locked-off + disabled', (phase) => {
    useRecordingStore.setState({ phase });
    for (const p of ['/free', '/sheet']) {
      const html = render(p);
      expect(html).toContain('class="rec-btn locked-off"');
      expect(html).toContain('aria-pressed="false"');
      expect(html).toContain('aria-label="저장 중엔 녹음을 바꿀 수 없어요"');
      expect(html).toContain('disabled');
    }
  });
});
