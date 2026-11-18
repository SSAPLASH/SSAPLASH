import { describe, expect, it } from 'vitest';

// 패드 이름 통일 가드: 화면·문구는 PAD_META.label(스몰탐·미드탐·플로어탐)만 쓴다.
// 샘플 원본 이름(「Polmuz 탐 1 F」, 띄어쓰기 있음)은 이 검사에 걸리지 않는다.
const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('패드 이름 통일', () => {
  it('FE 소스(테스트 제외)에 탐1·탐2·하이탐·미들탐 표기가 없다', () => {
    const hits: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      if (/\.test\.tsx?$/.test(path)) continue;
      if (/(탐[12]|하이탐|미들탐)/.test(text)) hits.push(path);
    }
    expect(hits).toEqual([]);
  });
});
