// 실물 하이햇 닫힘·페달 표시와 심벌 받침 층 마크업 검증(SSR 문자열)
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KIT_ART_PERSP, kitArtPad } from '@/domain/kit/kitArt';
import { kitFrame } from '@/domain/kit/kitFrame';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kit/kitLayout';
import { spriteUrl } from './acoustic/sprites';
import { DrumKit, type DrumKitProps } from './DrumKit';
import { Pad } from './Pad';

const BOX = { w: 1000, h: 625 };
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const closeDy = kitArtPad(KIT_ART_PERSP, 'HIHAT')?.top?.closeDy ?? 0;

interface Extra {
  closed?: boolean;
  pedalOff?: boolean;
  pedalHitSeq?: number;
}

/** 패드 하나만 그려 그 패드의 마크업을 본다 */
function onePad(pad: 'HIHAT' | 'HIHAT_PEDAL' | 'CRASH' | 'SNARE', extra: Extra) {
  const art = kitArtPad(KIT_ART_PERSP, pad)!;
  return renderToStaticMarkup(
    <svg>
      <Pad shape={art.shape} left={0} top={0} w={160} label="x" art={art} defsId="t" {...extra} />
    </svg>,
  );
}

describe('하이햇 원판 닫힘 표시', () => {
  it('closed true·undefined는 닫힘 표시가 있고 false는 없다', () => {
    expect(onePad('HIHAT', { closed: true })).toContain('data-closed');
    expect(onePad('HIHAT', {})).toContain('data-closed');
    const open = onePad('HIHAT', { closed: false });
    expect(open).not.toContain('data-closed');
    // 열림이어도 이동 그룹은 있다(CSS가 열림 위치로 옮긴다)
    expect(open).toContain('drum-pad-top');
  });

  it('닫힘 이동 거리는 closeDy(그림 단위)다', () => {
    expect(onePad('HIHAT', { closed: true })).toContain(`--close-dy:${closeDy}px`);
  });

  it('그룹 순서: 이동 → 칙 → 흔들림(원판 이미지가 가장 안쪽)', () => {
    const html = onePad('HIHAT', { closed: true });
    const top = html.indexOf('drum-pad-top');
    const pulse = html.indexOf('drum-pad-pulse');
    const sway = html.indexOf('drum-pad-cymbal');
    const img = html.indexOf(spriteUrl('hihat-top') ?? '');
    expect(top).toBeLessThan(pulse);
    expect(pulse).toBeLessThan(sway);
    expect(sway).toBeLessThan(img);
  });

  it('칙 모션은 pedalHitSeq가 0보다 클 때만 data-pulse', () => {
    expect(onePad('HIHAT', { closed: true })).not.toContain('data-pulse');
    expect(onePad('HIHAT', { closed: true, pedalHitSeq: 0 })).not.toContain('data-pulse');
    expect(onePad('HIHAT', { closed: true, pedalHitSeq: 3 })).toContain('data-pulse');
  });

  it('크래시·스네어에는 닫힘 표시가 없고 크래시는 흔들림 그룹만 있다', () => {
    for (const pad of ['CRASH', 'SNARE'] as const) {
      const html = onePad(pad, { closed: true, pedalHitSeq: 5 });
      expect(html).not.toContain('data-closed');
      expect(html).not.toContain('drum-pad-top');
      expect(html).not.toContain('data-pulse');
    }
    expect(onePad('CRASH', {})).toContain('drum-pad-cymbal');
  });
});

describe('하이햇 페달 그림', () => {
  it('닫힘이고 연결되어 있으면 눌린 자세(data-pressed)', () => {
    const html = onePad('HIHAT_PEDAL', { closed: true, pedalOff: false });
    expect(html).toContain('data-pressed');
    expect(html).not.toContain('data-off');
  });

  it('열림이면 눌린 자세가 없다', () => {
    expect(onePad('HIHAT_PEDAL', { closed: false, pedalOff: false })).not.toContain('data-pressed');
  });

  it('페달 없음이면 data-off이고 눌린 자세는 없다', () => {
    const html = onePad('HIHAT_PEDAL', { closed: true, pedalOff: true });
    expect(html).toContain('data-off');
    expect(html).not.toContain('data-pressed');
  });

  it('페달 모션은 pedalHitSeq가 0보다 클 때만', () => {
    expect(onePad('HIHAT_PEDAL', { closed: true })).not.toContain('data-pulse');
    expect(onePad('HIHAT_PEDAL', { closed: true, pedalHitSeq: 1 })).toContain('data-pulse');
  });
});

describe('DrumKit 하이햇 props', () => {
  const kit = (props: DrumKitProps) => renderToStaticMarkup(<DrumKit {...props} />);

  it('hihatClosed true/false/undefined → 닫힘 표시 있음/없음/있음', () => {
    expect(count(kit({ hihatClosed: true }), /data-closed/g)).toBe(1);
    expect(count(kit({ hihatClosed: false }), /data-closed/g)).toBe(0);
    expect(count(kit({}), /data-closed/g)).toBe(1);
  });

  it('pedalOff·pedalHitSeq는 하이햇·페달에만 닿는다(페달 data-off 1개, data-pulse 2개)', () => {
    const html = kit({ hihatClosed: true, pedalOff: true, pedalHitSeq: 2 });
    expect(count(html, /data-off/g)).toBe(1);
    expect(count(html, /data-pulse/g)).toBe(2);
    expect(count(html, /data-pressed/g)).toBe(0);
    expect(count(kit({ hihatClosed: true }), /data-pressed/g)).toBe(1);
  });

  it('전자·네온 마크업은 하이햇 props와 무관하다', () => {
    for (const skin of ['electronic', 'neon'] as const) {
      const base = kit({ skin });
      expect(kit({ skin, hihatClosed: false, pedalOff: true, pedalHitSeq: 4 })).toBe(base);
      expect(base).not.toContain('data-closed');
    }
  });
});

describe('심벌 받침 층', () => {
  const frame = kitFrame(DEFAULT_KIT_LAYOUT, BOX, 'acoustic');

  it('자유 틀: 라이드 받침 이미지가 플로어 탐 패드 그룹보다 앞에 있다', () => {
    const html = renderToStaticMarkup(<DrumKit frame={frame} />);
    const stand = html.indexOf(`href="${spriteUrl('ride')}"`);
    const floorTom = html.indexOf(`href="${spriteUrl('floor-tom')}"`);
    expect(stand).toBeGreaterThan(-1);
    expect(stand).toBeLessThan(floorTom);
    // 받침 이미지는 한 번만(패드 층에는 원판만)
    expect(count(html, new RegExp(`href="${spriteUrl('ride')}"`, 'g'))).toBe(1);
    expect(count(html, new RegExp(`href="${spriteUrl('ride-top')}"`, 'g'))).toBe(1);
    // 받침은 모두 첫 패드 그룹 앞에 깔린다
    expect(stand).toBeLessThan(html.indexOf('class="drum-pad"'));
  });

  it('숨긴 패드는 받침도 없다', () => {
    const html = renderToStaticMarkup(<DrumKit frame={frame} hidden={['RIDE']} />);
    expect(html).not.toContain(spriteUrl('ride'));
    expect(html).not.toContain(spriteUrl('ride-top'));
    expect(count(html, /class="drum-pad-under"/g)).toBe(2);
  });

  it('유령·흐림 같은 바깥 그룹 클래스가 받침에도 붙는다', () => {
    const html = renderToStaticMarkup(<DrumKit frame={frame} ghost="RIDE" faded={['CRASH']} />);
    const under = html.slice(0, html.indexOf('class="drum-pad"'));
    expect(under).toContain('drum-pad-ghost');
    expect(under).toContain('drum-pad-faded');
  });

  it('킥 진동 그룹이 받침까지 감싼다', () => {
    const html = renderToStaticMarkup(<DrumKit frame={frame} effects />);
    expect(html.indexOf('kit-shake')).toBeLessThan(html.indexOf('drum-pad-under'));
  });

  it('고정 배치도 두 층이고 실물 이미지는 12장 그대로다', () => {
    const html = renderToStaticMarkup(<DrumKit />);
    expect(count(html, /<image /g)).toBe(12);
    expect(count(html, /class="drum-pad-under"/g)).toBe(3);
  });

  it('전자·네온에는 받침 층이 없다', () => {
    for (const skin of ['electronic', 'neon'] as const) {
      expect(renderToStaticMarkup(<DrumKit skin={skin} />)).not.toContain('drum-pad-under');
    }
  });
});
