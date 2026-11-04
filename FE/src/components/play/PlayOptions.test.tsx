import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccompanimentStatus } from '@/domain/songCatalog';
import { PlayOptions } from './PlayOptions';

function options(hasAccompaniment: boolean, accompanimentStatus?: AccompanimentStatus | null): string {
  return renderToStaticMarkup(
    <PlayOptions
      metronome={false}
      onMetronome={() => {}}
      padCount={false}
      onPadCount={() => {}}
      hasAccompaniment={hasAccompaniment}
      accompanimentStatus={accompanimentStatus}
    />,
  );
}

describe('PlayOptions 반주 줄', () => {
  it('반주가 있으면 괄호 문구가 없다', () => {
    const html = options(true, 'READY');
    expect(html).toContain('반주 재생</span>');
  });

  it('반주가 없으면 생성 중은 「반주 생성 중」, 실패·대상 아님·모름은 「반주 없음」', () => {
    expect(options(false, 'GENERATING')).toContain('반주 재생 (반주 생성 중)');
    expect(options(false, 'FAILED')).toContain('반주 재생 (반주 없음)');
    expect(options(false, 'NONE')).toContain('반주 재생 (반주 없음)');
    expect(options(false)).toContain('반주 재생 (반주 없음)');
  });

  it('READY인데 아직 못 불러왔어도 문구가 비지 않는다', () => {
    expect(options(false, 'READY')).toContain('반주 재생 (반주 없음)');
  });
});
