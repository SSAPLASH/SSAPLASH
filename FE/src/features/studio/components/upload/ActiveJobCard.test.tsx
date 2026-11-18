import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ActiveJob, JobProgress } from '@/domain/song/chartJob';
import { ActiveJobCard } from './ActiveJobCard';

const job = (over: Partial<ActiveJob> = {}): ActiveJob => ({
  jobId: 1,
  songId: 7,
  title: '별빛 산책',
  idempotencyKey: 'k',
  startedAt: new Date(Date.now() - 72_000).toISOString(),
  ...over,
});
const prog = (over: Partial<JobProgress> = {}): JobProgress => ({ stage: 'SEPARATING', stageKnown: true, percent: null, failReason: null, ...over });

function render(j: ActiveJob, p: JobProgress): string {
  return renderToStaticMarkup(<ActiveJobCard job={j} progress={p} />);
}

/** 단계 li의 상태 클래스와 라벨을 순서대로 뽑는다 */
function steps(html: string): { cls: string; label: string }[] {
  return [...html.matchAll(/<li class="studio-job-step ?([^"]*)"[^>]*>.*?<span class="studio-job-step-label">(.*?)<\/span>/g)].map((m) => ({
    cls: m[1].trim(),
    label: m[2].replace(/<!-- -->/g, ''),
  }));
}

describe('ActiveJobCard', () => {
  it('제목과 생성 중 배지, 단계 4칸을 번호와 함께 그린다', () => {
    const html = render(job(), prog());
    expect(html).toContain('「별빛 산책」 생성 진행');
    expect(html).toContain('studio-badge-active');
    expect(html).toContain('채보 생성 중');
    expect(steps(html).map((s) => s.label)).toEqual(['1. 접수', '2. 드럼 분리', '3. 채보 생성', '4. 완료']);
  });

  it('단계를 알면 앞 칸은 완료, 현재 칸은 진행 중, 뒤는 비어 있다', () => {
    const html = render(job(), prog({ stage: 'SEPARATING' }));
    expect(steps(html).map((x) => x.cls)).toEqual(['done', 'active', '', '']);
    expect(html).toContain('aria-current="step"');
  });

  it('채보 생성 단계면 1·2칸 완료, 3칸 진행 중', () => {
    expect(steps(render(job(), prog({ stage: 'TRANSCRIBING' }))).map((x) => x.cls)).toEqual(['done', 'done', 'active', '']);
  });

  it('단계를 모르면(폴링) 접수는 완료, 분리·생성 두 칸을 함께 진행 중으로 칠한다', () => {
    const s = steps(render(job(), prog({ stage: 'QUEUED', stageKnown: false })));
    expect(s.map((x) => x.cls)).toEqual(['done', 'active', 'active', '']);
  });

  it('완료면 모든 칸이 완료이고 진행 중 칸이 없다', () => {
    const html = render(job(), prog({ stage: 'DONE' }));
    expect(steps(html).map((x) => x.cls)).toEqual(['done', 'done', 'done', 'done']);
    expect(html).not.toContain('aria-current');
  });

  it('0과 100은 접근 가능한 진행률로 보이고 null은 숨긴다', () => {
    for (const percent of [0, 100]) {
      const html = render(job(), prog({ percent }));
      expect(html).toContain('role="progressbar"');
      expect(html).toContain(`aria-valuenow="${percent}"`);
      expect(html).toContain(`진행률 ${percent}%`);
    }
    expect(render(job(), prog({ percent: null }))).not.toContain('role="progressbar"');
  });

  it('경과 시간을 「n분 n초」로 보인다', () => {
    const html = render(job(), prog());
    expect(html).toContain('경과');
    expect(html).toMatch(/1분 1\d초/);
  });

  it('시작 시각이 잘못되면 0분 0초', () => {
    expect(render(job({ startedAt: 'x' }), prog())).toContain('0분 0초');
  });

  it('하루 넘게 처리 중이면 안내를 덧붙인다', () => {
    const old = new Date(Date.now() - 25 * 3600_000).toISOString();
    expect(render(job({ startedAt: old }), prog())).toContain('하루 넘게 처리 중입니다');
    expect(render(job(), prog())).not.toContain('하루 넘게');
  });
});
