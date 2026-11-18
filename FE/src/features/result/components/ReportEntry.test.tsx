import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Report } from '@/domain/play/report';
import type { PlayUploadState } from '@/domain/play/playLog';
import { ReportEntry } from './ReportEntry';

const done: PlayUploadState = { status: 'DONE', reason: null, retryable: false, attempts: 1, updatedAt: '2026-10-28T00:00:00Z' };

const report = (analysisStatus: Report['analysisStatus'], weakSegments: Report['weakSegments']): Report => ({
  playId: 'p',
  score: 0,
  accuracy: 1,
  maxCombo: 0,
  counts: { PERFECT: 40, GOOD: 0, MISS: 0 },
  histogram: null,
  padStats: [],
  mode: 'SHEET',
  songId: null,
  chartId: null,
  difficulty: null,
  inputSource: 'KEYBOARD', playbackRate: 1,
  analysisStatus,
  weakSegments,
  coachSummary: null,
  recommendedDrills: null,
  generatedAt: '2026-10-28T00:00:00Z',
});

function render(st: PlayUploadState | undefined, r: Report | null): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ReportEntry playId="p" legacy={false} state={st} report={r} onRetry={() => {}} />
    </MemoryRouter>,
  );
}

describe('ReportEntry 설명 문구', () => {
  it('리포트가 없으면 기존 설명', () => {
    expect(render(done, null)).toContain('패드별 정확도·타이밍·노트 흐름');
  });
  it('NOT_REQUESTED는 기존 설명', () => {
    expect(render(done, report('NOT_REQUESTED', null))).toContain('패드별 정확도·타이밍·노트 흐름');
  });
  it('PENDING이면 분석 중 문구', () => {
    expect(render(done, report('PENDING', null))).toContain('AI가 연주를 분석하고 있어요');
  });
  it('DONE이면 약점 개수 문구', () => {
    expect(render(done, report('DONE', [{ fromMs: 0, toMs: 1, pattern: 'X', description: 'd', causeTags: [], pads: [], severity: 0, scope: 'SEGMENT', metrics: {} }]))).toContain(
      'AI가 약점 1곳을 찾았어요',
    );
  });
  it('업로드 중에는 리포트가 있어도 저장 중 문구', () => {
    expect(render({ ...done, status: 'UPLOADING' }, report('DONE', []))).toContain('기록 저장 중…');
  });
});
