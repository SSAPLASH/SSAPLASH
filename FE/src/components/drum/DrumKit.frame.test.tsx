// DrumKit 자유 틀(드럼 세팅 원근 보기) 검증: 틀 크기·자리·순서, 하이햇 페달, 전자·네온 눌림. SSR 문자열.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KIT_SKINS } from '@/domain/kit/drumKit';
import { KIT_ART_PERSP, kitArtPad } from '@/domain/kit/kitArt';
import { kitFrame } from '@/domain/kit/kitFrame';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import { DrumKit } from './DrumKit';
import { Pad, PadDefs } from './Pad';

const BOX = { w: 1000, h: 625 };
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('DrumKit frame', () => {
  it('틀 크기를 viewBox·크기로 쓰고 하이햇 페달까지 9패드를 그린다', () => {
    const frame = kitFrame(DEFAULT_KIT_LAYOUT, BOX, 'acoustic');
    const html = renderToStaticMarkup(<DrumKit frame={frame} />);
    expect(html).toContain('viewBox="0 0 1000 625"');
    expect(html).toContain('width="1000"');
    expect(count(html, /class="drum-pad"/g)).toBe(9);
    expect(html).toContain('data-shape="pedal"');
  });

  it('패드는 틀이 준 자리·크기로, 목록 순서(먼 것부터)대로 그린다', () => {
    const frame = kitFrame(DEFAULT_KIT_LAYOUT, BOX, 'acoustic');
    const html = renderToStaticMarkup(<DrumKit frame={frame} />);
    // 심벌 받침 층은 모두 그보다 앞에 깔리므로, 패드 그룹(class="drum-pad")부터 순서를 본다
    const main = html.slice(html.indexOf('class="drum-pad"'));
    let at = -1;
    for (const p of frame.pads) {
      const next = main.indexOf(`translate(${p.left} ${p.top}) scale(${p.w / 160})`);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });

  it('전자·네온은 원판을 세로로 누르고 실물은 누르지 않는다', () => {
    for (const skin of ['electronic', 'neon'] as const) {
      const html = renderToStaticMarkup(<DrumKit frame={kitFrame(DEFAULT_KIT_LAYOUT, BOX, skin)} skin={skin} />);
      // 킥을 뺀 8패드
      expect(count(html, /translate\(0 80\) scale\(1 0\.\d+\) translate\(0 -80\)/g)).toBe(8);
    }
    const acoustic = renderToStaticMarkup(<DrumKit frame={kitFrame(DEFAULT_KIT_LAYOUT, BOX, 'acoustic')} />);
    expect(acoustic).not.toContain('translate(0 80) scale(1 ');
  });

  it('보정용 표시(hidden·dimAll·lit·selectedPad)는 틀에서도 같다', () => {
    const frame = kitFrame(DEFAULT_KIT_LAYOUT, BOX, 'acoustic');
    const html = renderToStaticMarkup(<DrumKit frame={frame} hidden={['RIDE']} dimAll lit="SNARE" selectedPad="CRASH" />);
    expect(count(html, /class="drum-pad"/g)).toBe(8);
    // 라이드를 숨기면 7패드: 심벌(크래시·하이햇)은 받침 층이 따로 있어 dim이 둘씩 붙는다
    expect(count(html, /drum-pad-dim/g)).toBe(7 + 2);
    expect(count(html, /drum-pad-lit/g)).toBe(1);
    expect(html).toContain('data-selected-pad="CRASH"');
  });
});

describe('하이햇 페달 스킨', () => {
  it('세 스킨 모두 페달을 상태별로 예외 없이 그린다', () => {
    for (const skin of KIT_SKINS) {
      for (const state of ['idle', 'armed', 'hit', 'perfect', 'good', 'miss'] as const) {
        const html = renderToStaticMarkup(
          <svg>
            <PadDefs id="t" />
            <Pad shape="pedal" left={0} top={0} w={160} state={state} label="페달" tag="HP" skin={skin} art={kitArtPad(KIT_ART_PERSP, 'HIHAT_PEDAL')} defsId="t" />
          </svg>,
        );
        expect(html).toContain('data-shape="pedal"');
        expect(html).toContain('>페달<');
      }
    }
  });
});
