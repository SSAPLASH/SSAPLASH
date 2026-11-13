import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AudioDropzone } from './AudioDropzone';
import { SongCoverDialog } from '@/features/studio/components/songs/SongCoverDialog';
import { UploadPanel, type UploadTab } from './UploadPanel';
import type { SongSummary } from '@/domain/song/songCatalog';

const noop = () => {};
const audio = { busy: false, error: null, retryable: false, onSubmit: noop, onRetry: noop, prefill: null, onCancelPrefill: noop };
const midi = { busy: false, error: null, onSubmit: noop };

function panel(tab: UploadTab, over: { audioBusyTitle?: string | null; locked?: boolean; onCancel?: () => void } = {}): string {
  return renderToStaticMarkup(
    <UploadPanel
      tab={tab}
      onTab={noop}
      locked={over.locked ?? false}
      audio={audio}
      audioBusyTitle={over.audioBusyTitle ?? null}
      midi={midi}
      onCancel={over.onCancel}
    />,
  );
}

/** 탭 Chip 두 개의 (라벨, selected, disabled)를 뽑는다 */
function chips(html: string): { label: string; selected: boolean; disabled: boolean }[] {
  return [...html.matchAll(/<button([^>]*class="ui-chip[^"]*"[^>]*)>(.*?)<\/button>/g)].map((m) => ({
    label: m[2],
    selected: m[1].includes('aria-pressed="true"'),
    disabled: m[1].includes('disabled'),
  }));
}

describe('UploadPanel', () => {
  it('탭 Chip 「음원」「MIDI·MusicXML」 중 현재 탭만 selected', () => {
    expect(chips(panel('AUDIO'))).toEqual([
      { label: '음원', selected: true, disabled: false },
      { label: 'MIDI·MusicXML', selected: false, disabled: false },
    ]);
    expect(chips(panel('MIDI')).map((c) => c.selected)).toEqual([false, true]);
  });

  it('업로드 중(locked)이면 다른 탭 Chip만 비활성', () => {
    expect(chips(panel('AUDIO', { locked: true })).map((c) => c.disabled)).toEqual([false, true]);
  });

  it('음원 탭은 드롭존, MIDI 탭은 MIDI 양식', () => {
    expect(panel('AUDIO')).toContain('음원 파일을 여기에 끌어다 놓으세요');
    expect(panel('MIDI')).toContain('MIDI·MusicXML 파일을 여기에 끌어다 놓으세요');
  });

  it('음원 생성 중이면 음원 탭이 안내 문구로 바뀐다(드롭존 없음)', () => {
    const html = panel('AUDIO', { audioBusyTitle: '별빛 산책' });
    expect(html).toContain('「별빛 산책」');
    expect(html).toContain('생성이 끝나면 올릴 수 있어요');
    expect(html).not.toContain('studio-drop');
  });

  it('음원 생성 중이어도 MIDI 탭은 양식을 그린다', () => {
    expect(panel('MIDI', { audioBusyTitle: '별빛 산책' })).toContain('MIDI·MusicXML 파일을 여기에 끌어다 놓으세요');
  });

  it('안내 문구 상태에서도 onCancel이 있으면 [취소] secondary md', () => {
    const html = panel('AUDIO', { audioBusyTitle: 'a', onCancel: noop });
    expect(html).toContain('ui-btn ui-btn-secondary ui-btn-md');
    expect(html).toContain('취소');
    expect(panel('AUDIO', { audioBusyTitle: 'a' })).not.toContain('취소');
  });
});

describe('AudioDropzone 문구', () => {
  const html = renderToStaticMarkup(<AudioDropzone {...audio} />);

  it('제한 문구: MP3·WAV·M4A·OPUS · 50MiB 이하 · 10분 이하', () => {
    expect(html).toContain('MP3·WAV·M4A·OPUS · 50MiB 이하 · 10분 이하');
  });

  it('보관 정책 문구: 올린 음원과 분리한 드럼 트랙은 채보를 만든 뒤 지운다', () => {
    expect(html).toContain('올린 음원과 분리한 드럼 트랙은 채보를 만든 뒤 지워요');
    expect(html).toContain('studio-policy-note');
  });

  it('[채보 만들기]는 파일이 없어 비활성, [취소]는 onCancel이 있을 때만', () => {
    expect(html).toMatch(/ui-btn-primary[^>]*disabled=""[^>]*>채보 만들기/);
    expect(html).not.toContain('>취소<');
    expect(renderToStaticMarkup(<AudioDropzone {...audio} onCancel={noop} />)).toContain('>취소<');
  });

  it('드롭존 파일 버튼은 sm', () => {
    expect(html).toMatch(/ui-btn-secondary ui-btn-sm[^>]*studio-drop-btn/);
  });

  it('다시 올리기(prefill)는 제목을 채우고 안내 줄을 둔다', () => {
    const re = renderToStaticMarkup(<AudioDropzone {...audio} prefill={{ title: '별빛 산책', artist: '파란물결' }} />);
    expect(re).toContain('다시 올리기 — 파일만 다시 골라 주세요');
    expect(re).toContain('value="별빛 산책"');
  });
});

describe('SongCoverDialog', () => {
  const song = { id: 7, title: '별빛 산책', coverUrl: null } as SongSummary;

  it('용량 안내 「10 MiB 이하」와 형식 문구', () => {
    const html = renderToStaticMarkup(<SongCoverDialog song={song} busy={false} error={null} onSave={noop} onClose={noop} />);
    expect(html).toContain('JPG·PNG·WebP · 10 MiB 이하');
    expect(html).toContain('커버 변경');
  });

  it('바뀐 게 없으면 저장 비활성', () => {
    const html = renderToStaticMarkup(<SongCoverDialog song={song} busy={false} error={null} onSave={noop} onClose={noop} />);
    expect(html).toMatch(/disabled=""[^>]*>저장/);
  });
});
