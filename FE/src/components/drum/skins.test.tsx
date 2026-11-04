// 전자·네온 스킨 마크업 테스트
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { kitPadsFor, KIT_SKINS, type KitSkin, type PadShape, type PadVisualState } from '@/domain/drumKit';
import { DrumKit } from './DrumKit';
import { Pad, PadDefs } from './Pad';

const SHAPES: PadShape[] = ['drum', 'cymbal', 'kick'];
const STATES: PadVisualState[] = ['idle', 'armed', 'hit', 'perfect', 'good', 'miss'];

function pad(skin: KitSkin, shape: PadShape, state: PadVisualState, extra: { tag?: string; label?: string } = {}) {
  return renderToStaticMarkup(
    <svg>
      <PadDefs id="t" />
      <Pad shape={shape} left={0} top={0} w={160} state={state} label={extra.label ?? '스네어'} tag={extra.tag} skin={skin} defsId="t" />
    </svg>,
  );
}

const FLAT: KitSkin[] = ['electronic', 'neon'];

describe('2D 스킨 렌더', () => {
  it('3스킨 × 3모양 × 6상태가 예외 없이 그려진다', () => {
    for (const skin of KIT_SKINS) {
      for (const shape of SHAPES) {
        for (const state of STATES) {
          expect(pad(skin, shape, state)).toContain(`data-state="${state}"`);
        }
      }
    }
  });

  it('2D 스킨의 판정 링은 원이다', () => {
    for (const skin of FLAT) {
      for (const shape of SHAPES) {
        const html = pad(skin, shape, 'perfect');
        expect(html).toMatch(/<circle class="drum-pad-ring perfect"/);
        expect(html).not.toContain('<ellipse');
      }
    }
  });

  it('hit에는 LED(전자)·flash가 있고 idle에는 없다', () => {
    for (const shape of SHAPES) {
      expect(pad('electronic', shape, 'hit')).toContain('drum-pad-led');
      expect(pad('electronic', shape, 'hit')).toContain('drum-pad-flash');
      expect(pad('electronic', shape, 'idle')).not.toContain('drum-pad-led');
      expect(pad('electronic', shape, 'idle')).not.toContain('drum-pad-flash');
      expect(pad('neon', shape, 'hit')).toContain('drum-pad-flash');
      expect(pad('neon', shape, 'idle')).not.toContain('drum-pad-flash');
    }
  });

  it('전자 판정 상태에는 LED가 없다', () => {
    expect(pad('electronic', 'drum', 'good')).not.toContain('drum-pad-led');
    expect(pad('electronic', 'drum', 'armed')).toContain('drum-pad-led');
  });

  it('tag·label·판정 글자가 출력된다', () => {
    for (const skin of FLAT) {
      const html = pad(skin, 'drum', 'miss', { tag: 'SN', label: '스네어' });
      expect(html).toContain('class="drum-pad-tag"');
      expect(html).toContain('>SN</text>');
      expect(html).toContain('>스네어</text>');
      expect(html).toContain('>MISS</text>');
      expect(html).toContain(`data-skin="${skin}"`);
    }
  });

  it('실물 스킨에는 data-skin·tag가 없다', () => {
    const html = pad('acoustic', 'drum', 'idle', { tag: 'SN' });
    expect(html).not.toContain('data-skin');
    expect(html).not.toContain('drum-pad-tag');
  });
});

describe('DrumKit 스킨', () => {
  it('skin별 패드 8개가 kitPadsFor 좌표에 놓인다', () => {
    for (const skin of KIT_SKINS) {
      const html = renderToStaticMarkup(<DrumKit skin={skin} />);
      const pads = kitPadsFor(skin);
      const found = [...html.matchAll(/class="drum-pad" data-state="idle" data-shape="\w+"(?: data-skin="\w+")? transform="([^"]+)"/g)].map(
        (m) => m[1],
      );
      expect(found).toHaveLength(8);
      expect(found).toEqual(pads.map((p) => `translate(${p.left} ${p.top}) scale(${p.w / 160})`));
      expect(html.includes('<svg class="drum-kit"')).toBe(true);
      expect(/<svg class="drum-kit"[^>]*data-skin=/.test(html)).toBe(skin !== 'acoustic');
    }
  });
});
