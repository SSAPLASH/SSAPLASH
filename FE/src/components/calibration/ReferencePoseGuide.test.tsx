// 자세 안내 그림 표시 검증(PLAY-004): 제목·그림 두 장·세 줄 안내, 상태별 강조·체크, 움직임 줄이기 윤곽.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReferencePoseGuide } from './ReferencePoseGuide';

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('ReferencePoseGuide', () => {
  it('제목, 그림 두 장, 세 줄 안내가 보인다', () => {
    const html = renderToStaticMarkup(<ReferencePoseGuide state="idle" reducedMotion={false} />);
    expect(html).toContain('편안히 들고 스틱 끝을 모아 주세요');
    expect(html).toContain('위에서 본 모습');
    expect(html).toContain('옆에서 본 모습');
    expect(count(html, 'role="img"')).toBe(2);
    expect(html).toContain('aria-label="화면을 마주 보고 앉아 두 손을 가까이 모으고 스틱 끝을 맞댄 모습"');
    expect(html).toContain('화면을 마주 보고 편하게 앉아요');
    expect(html).toContain('두 손을 가까이 모으고 스틱 끝을 맞대요');
    expect(html).toContain('버튼을 누르고 3초간 가만히 있어요');
  });

  it('대기는 안내 ①②, 유지·흔들림은 ③만 강조하고 완료는 강조가 없다', () => {
    expect(count(renderToStaticMarkup(<ReferencePoseGuide state="idle" reducedMotion={false} />), 'class="on"')).toBe(2);
    for (const s of ['holding', 'shaky'] as const) {
      const html = renderToStaticMarkup(<ReferencePoseGuide state={s} reducedMotion={false} />);
      expect(count(html, 'class="on"')).toBe(1);
      expect(html).toContain('<li class="on"><i aria-hidden="true">3</i>');
      expect(html).toContain(`data-state="${s}"`);
    }
    expect(count(renderToStaticMarkup(<ReferencePoseGuide state="done" reducedMotion={false} />), 'class="on"')).toBe(0);
  });

  it('완료에서만 두 그림에 체크가 나온다', () => {
    expect(count(renderToStaticMarkup(<ReferencePoseGuide state="done" reducedMotion={false} />), 'pose-guide-check')).toBe(2);
    expect(count(renderToStaticMarkup(<ReferencePoseGuide state="holding" reducedMotion={false} />), 'pose-guide-check')).toBe(0);
  });

  it('움직임 줄이기에서는 대기 상태에만 벌어진 자세 윤곽이 겹친다', () => {
    const reducedIdle = renderToStaticMarkup(<ReferencePoseGuide state="idle" reducedMotion />);
    expect(reducedIdle).toContain('pose-guide reduced');
    expect(count(reducedIdle, 'pose-guide-ghost')).toBe(2);
    expect(count(renderToStaticMarkup(<ReferencePoseGuide state="holding" reducedMotion />), 'pose-guide-ghost')).toBe(0);
    expect(count(renderToStaticMarkup(<ReferencePoseGuide state="idle" reducedMotion={false} />), 'pose-guide-ghost')).toBe(0);
  });
});
