import { describe, expect, it } from 'vitest';
import { COVER_MAX_INPUT_BYTES, centerSquareCrop, defaultCover, precheckCover } from './songCover';

describe('defaultCover', () => {
  it('같은 제목은 항상 같은 색이고 0~359 범위다', () => {
    const a = defaultCover('Back in Black');
    expect(defaultCover('Back in Black')).toEqual(a);
    expect(a.hue).toBeGreaterThanOrEqual(0);
    expect(a.hue).toBeLessThan(360);
  });

  it('제목이 다르면 색이 달라질 수 있다', () => {
    const hues = new Set(['가', '나', '다', '라', '마', 'a', 'b', 'c'].map((t) => defaultCover(t).hue));
    expect(hues.size).toBeGreaterThan(1);
  });

  it('앞뒤 공백은 색과 글자에 영향이 없다', () => {
    expect(defaultCover('  곡 ')).toEqual(defaultCover('곡'));
  });

  it('글자: 한글은 그대로, 영문은 대문자, 숫자는 그대로', () => {
    expect(defaultCover('안녕').letter).toBe('안');
    expect(defaultCover('  hello').letter).toBe('H');
    expect(defaultCover('7 Nation Army').letter).toBe('7');
  });

  it('글자: 없거나 기호·이모지로 시작하면 ♪', () => {
    expect(defaultCover('').letter).toBe('♪');
    expect(defaultCover('   ').letter).toBe('♪');
    expect(defaultCover('!!!').letter).toBe('♪');
    expect(defaultCover('🎵 노래').letter).toBe('♪');
  });
});

describe('precheckCover', () => {
  it('jpeg·png·webp는 통과한다', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(precheckCover({ type, size: 1000 })).toEqual({ ok: true });
  });

  it('다른 형식은 UNSUPPORTED', () => {
    expect(precheckCover({ type: 'image/gif', size: 1000 })).toEqual({ ok: false, reason: 'UNSUPPORTED' });
    expect(precheckCover({ type: '', size: 1000 })).toEqual({ ok: false, reason: 'UNSUPPORTED' });
  });

  it('원본 10 MiB 이하만, 빈 파일은 EMPTY', () => {
    expect(precheckCover({ type: 'image/png', size: COVER_MAX_INPUT_BYTES })).toEqual({ ok: true });
    expect(precheckCover({ type: 'image/png', size: COVER_MAX_INPUT_BYTES + 1 })).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(precheckCover({ type: 'image/png', size: 0 })).toEqual({ ok: false, reason: 'EMPTY' });
  });
});

describe('centerSquareCrop', () => {
  it('가로로 긴 이미지는 좌우를 자른다', () => {
    expect(centerSquareCrop(1000, 600)).toEqual({ sx: 200, sy: 0, size: 600 });
  });

  it('세로로 긴 이미지는 위아래를 자른다', () => {
    expect(centerSquareCrop(600, 1000)).toEqual({ sx: 0, sy: 200, size: 600 });
  });

  it('정사각형은 그대로, 홀수 차이는 내림', () => {
    expect(centerSquareCrop(500, 500)).toEqual({ sx: 0, sy: 0, size: 500 });
    expect(centerSquareCrop(11, 6)).toEqual({ sx: 2, sy: 0, size: 6 });
  });

  it('크기를 알 수 없으면 null', () => {
    expect(centerSquareCrop(0, 100)).toBeNull();
    expect(centerSquareCrop(NaN, 100)).toBeNull();
  });
});
