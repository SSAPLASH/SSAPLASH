// 녹음 버튼·상태 표시가 있는 GlassDock. 기존 GlassDock.test.tsx와 모듈 목이 섞이지 않게 파일을 나눴다.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRecordingForTest, useRecordingStore } from '@/runtime/recordingStore';
import { useSettings } from '@/store/settingsStore';
import { GlassDock } from './GlassDock';

// renderToStaticMarkup은 zustand의 서버 스냅샷(초기 상태)을 읽으므로, 훅이 현재 상태를 읽도록 바꾼다
vi.mock('@/runtime/recordingStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/runtime/recordingStore')>();
  const hook = <T,>(sel: (s: ReturnType<typeof actual.useRecordingStore.getState>) => T) => sel(actual.useRecordingStore.getState());
  return { ...actual, useRecordingStore: Object.assign(hook, actual.useRecordingStore) };
});
vi.mock('@/store/settingsStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/settingsStore')>();
  const hook = <T,>(sel: (s: ReturnType<typeof actual.useSettings.getState>) => T) => sel(actual.useSettings.getState());
  return { ...actual, useSettings: Object.assign(hook, actual.useSettings) };
});

function render(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <GlassDock />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetRecordingForTest();
  useSettings.setState({ dockCollapsed: false });
});

describe('GlassDock 녹음 슬롯(스위치 켜짐)', () => {
  it('/free에서 [BPM +] 다음에 구분선과 녹음 버튼', () => {
    const html = render('/free');
    expect(html).toMatch(/aria-label="BPM 5 증가".*?<span class="dock-divider"><\/span><button[^>]*class="rec-btn idle"/s);
    // 사운드 뒤·녹음 앞 2개(프리셋 칩과 그 앞 구분선은 11/04 Dock에서 뺐다)
    expect((html.match(/dock-divider/g) ?? []).length).toBe(2);
  });

  it('/history에서는 버튼도 추가 구분선도 없다', () => {
    const html = render('/history');
    expect(html).not.toContain('rec-btn');
    expect((html.match(/dock-divider/g) ?? []).length).toBe(1);
  });

  it('접힘: 녹음 중이 아니면 꺼진 원, 자유 녹음 중이면 빨간 원(표시만)', () => {
    useSettings.setState({ dockCollapsed: true });
    expect(render('/free')).toMatch(/<span class="dock-rec-status" role="img" aria-label="녹음 안 함">/);
    useRecordingStore.setState({ phase: 'recording', free: { startPerfMs: 0, startedAt: new Date(), hitCount: 0 } });
    const html = render('/free');
    expect(html).toMatch(/<span class="dock-rec-status on" role="img" aria-label="녹음 중">/);
    // 접힌 Dock에는 녹음 버튼이 없다(조작은 펼친 Dock)
    expect(html).not.toContain('rec-btn');
  });

  it('접힘: armed는 잠겨 있을 때만 빨간 원', () => {
    useSettings.setState({ dockCollapsed: true });
    useRecordingStore.setState({ phase: 'armed', locked: false });
    expect(render('/sheet')).toContain('class="dock-rec-status"');
    useRecordingStore.setState({ phase: 'armed', locked: true });
    expect(render('/sheet')).toContain('dock-rec-status on');
  });

  it('리듬 게임(/play)에는 녹음 버튼도 녹음 상태도 없다(녹음 대기·잠금이어도)', () => {
    useRecordingStore.setState({ phase: 'armed', locked: true });
    useSettings.setState({ dockCollapsed: false });
    expect(render('/play')).not.toContain('rec-btn');
    useSettings.setState({ dockCollapsed: true });
    expect(render('/play')).not.toContain('dock-rec-status');
  });

  it('접힘: 녹음 버튼이 없는 화면에는 녹음 상태도 없다', () => {
    useSettings.setState({ dockCollapsed: true });
    expect(render('/history')).not.toContain('dock-rec-status');
  });
});
