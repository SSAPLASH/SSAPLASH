import { describe, expect, it } from 'vitest';
import {
  MODE_CARD_FINAL,
  PAD_FLASH_MS,
  RIPPLE_REMOVE_MS,
  RIPPLE_TIMING,
  STRIKE_PAD_SEQUENCE,
  billboardTransform,
  billboardValues,
  chartLayerOpacity,
  chartTab,
  clamp,
  easeInOutCubic,
  fillClip,
  glowKeyframes,
  heroValues,
  isAccentHit,
  isStrike,
  modeCardValues,
  pickStrikePad,
  span,
  statementLineFill,
  statementSubValues,
  stickLayers,
  stickStep,
  swingAngle,
  swingSign,
} from './landingMotion';

describe('landingMotion 공통', () => {
  it('clamp·span·ease', () => {
    expect(clamp(2)).toBe(1);
    expect(clamp(-1)).toBe(0);
    expect(span(0.5, 0.25, 0.75)).toBeCloseTo(0.5);
    expect(span(0, 0.25, 0.75)).toBe(0);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(1)).toBeCloseTo(1);
  });

  it('fillClip', () => {
    expect(fillClip(0)).toBe('inset(0 100% 0 0)');
    expect(fillClip(0.25)).toBe('inset(0 75% 0 0)');
    expect(fillClip(1)).toBe('inset(0 0% 0 0)');
  });
});

describe('히어로', () => {
  it('진행도 0', () => {
    const v = heroValues(0);
    expect(v.photoScale).toBeCloseTo(1.06);
    expect(v.innerOpacity).toBe(1);
    expect(v.innerY).toBeCloseTo(0);
    expect(v.innerScale).toBe(1);
    expect(v.wipeClip).toBe('polygon(0 120%, 100% 98%, 100% 120%, 0 120%)');
  });

  it('진행도 0.5', () => {
    const v = heroValues(0.5);
    expect(v.photoScale).toBeCloseTo(1.13);
    expect(v.innerOpacity).toBeCloseTo(0); // fade 구간(0~.38)이 끝난 뒤
    const w = easeInOutCubic(0.32 / 0.82);
    const L = 120 - w * 150;
    const m = /^polygon\(0 (\S+)%, 100% (\S+)%, 100% 120%, 0 120%\)$/.exec(v.wipeClip);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(L);
    expect(Number(m![2])).toBeCloseTo(L - 22);
  });

  it('진행도 1', () => {
    const v = heroValues(1);
    expect(v.photoScale).toBeCloseTo(1.2);
    expect(v.innerOpacity).toBe(0);
    expect(v.innerY).toBeCloseTo(-60);
    expect(v.innerScale).toBeCloseTo(0.96);
    expect(v.wipeClip).toBe('polygon(0 -30%, 100% -52%, 100% 120%, 0 120%)');
  });

  it('글자 사라짐 중간(.19)은 절반', () => {
    expect(heroValues(0.19).innerOpacity).toBeCloseTo(0.5);
  });
});

describe('한 문장', () => {
  it('줄별 채움 구간', () => {
    expect(statementLineFill(0.05, 0)).toBe(0);
    expect(statementLineFill(0.215, 0)).toBeCloseTo(0.5);
    expect(statementLineFill(0.38, 0)).toBeCloseTo(1);
    expect(statementLineFill(0.35, 1)).toBe(0);
    expect(statementLineFill(0.68, 1)).toBeCloseTo(1);
    expect(statementLineFill(0.65, 2)).toBe(0);
    expect(statementLineFill(1, 2)).toBeCloseTo(1);
  });

  it('보조 문구', () => {
    expect(statementSubValues(0.72)).toEqual({ opacity: 0, y: 16 });
    const mid = statementSubValues(0.81);
    expect(mid.opacity).toBeCloseTo(0.5);
    expect(mid.y).toBeCloseTo(8);
    expect(statementSubValues(1)).toEqual({ opacity: 1, y: 0 });
  });
});

describe('센서 스틱 단계', () => {
  it('경계 .34/.67', () => {
    expect(stickStep(0)).toBe(0);
    expect(stickStep(0.33)).toBe(0);
    expect(stickStep(0.34)).toBe(1);
    expect(stickStep(0.66)).toBe(1);
    expect(stickStep(0.67)).toBe(2);
    expect(stickStep(1)).toBe(2);
  });

  it('층 투명도', () => {
    expect(stickLayers(0)).toEqual({ pad: 0, imu: 1, ble: 0 });
    expect(stickLayers(1)).toEqual({ pad: 1, imu: 0.25, ble: 0 });
    expect(stickLayers(2)).toEqual({ pad: 1, imu: 0.25, ble: 1 });
  });
});

describe('채보', () => {
  it('층 투명도', () => {
    const z = chartLayerOpacity(0);
    expect(z[0]).toBe(1);
    expect(z[1]).toBe(0);
    expect(z[2]).toBe(0);
    const a = chartLayerOpacity(0.3); // k=.6 → span=1/6
    expect(a[0]).toBeCloseTo(1 - 1 / 6);
    expect(a[1]).toBeCloseTo(1 / 6);
    expect(a[2]).toBe(0);
    const b = chartLayerOpacity(0.5); // k=1: 드럼만
    expect(b[0]).toBeCloseTo(0);
    expect(b[1]).toBeCloseTo(1);
    expect(b[2]).toBe(0);
    const c = chartLayerOpacity(1);
    expect(c[0]).toBeCloseTo(0);
    expect(c[1]).toBeCloseTo(0);
    expect(c[2]).toBeCloseTo(1);
  });

  it('탭 경계 k<.7, k<1.45', () => {
    expect(chartTab(0)).toBe(0);
    expect(chartTab(0.34)).toBe(0); // k=.68
    expect(chartTab(0.35)).toBe(1); // k=.70
    expect(chartTab(0.72)).toBe(1); // k=1.44
    expect(chartTab(0.73)).toBe(2); // k=1.46
    expect(chartTab(1)).toBe(2);
  });
});

describe('모드 카드', () => {
  it('진행도 1은 최종 상태', () => {
    for (let i = 0; i < 3; i++) {
      const v = modeCardValues(1, i, 800);
      expect(v.y).toBeCloseTo(MODE_CARD_FINAL.y[i]);
      expect(v.rotate).toBeCloseTo(MODE_CARD_FINAL.rotate[i]);
      expect(v.opacity).toBeCloseTo(1);
    }
    expect(MODE_CARD_FINAL.y).toEqual([-24, 30, -40]);
    expect(MODE_CARD_FINAL.rotate).toEqual([-3, 1.5, 3.5]);
  });

  it('진행도 0은 화면 아래에서 기울어진 상태', () => {
    expect(modeCardValues(0, 1, 800).y).toBeCloseTo(720);
    expect(modeCardValues(0, 1, 800).rotate).toBeCloseTo(0);
    expect(modeCardValues(0, 1, 800).opacity).toBeCloseTo(0.3);
    expect(modeCardValues(0, 0, 800).rotate).toBeCloseTo(-16);
    expect(modeCardValues(0, 2, 800).rotate).toBeCloseTo(16);
  });

  it('카드 시작 구간은 i마다 .12씩 늦다', () => {
    expect(modeCardValues(0.2, 2, 800).opacity).toBeCloseTo(
      0.3 + 0.7 * easeInOutCubic(span(0.2, 0.26, 0.66)),
    );
    expect(modeCardValues(0.14, 1, 800).y).toBeCloseTo(720); // 2번째 카드는 .14부터
  });
});

describe('전광판', () => {
  it('진행도 0', () => {
    const v = billboardValues(0);
    expect(v.x).toBeCloseTo(55);
    expect(v.rotateY).toBeCloseTo(-38);
    expect(v.rotateZ).toBeCloseTo(-4);
    expect(v.skewX).toBeCloseTo(-10);
    expect(v.fill).toBe(0);
    expect(v.neon).toBe(false);
    expect(v.headOpacity).toBe(0);
    expect(billboardTransform(0)).toBe(
      'translateX(55vw) rotateY(-38deg) rotateZ(-4deg) skewX(-10deg)',
    );
  });

  it('진행도 1은 정면·채움 완료', () => {
    const v = billboardValues(1);
    expect(v.x).toBeCloseTo(0);
    expect(v.rotateY).toBeCloseTo(0);
    expect(v.fill).toBeCloseTo(1);
    expect(v.neon).toBe(true);
    expect(v.headOpacity).toBe(1);
  });

  it('네온 경계 .86', () => {
    expect(billboardValues(0.86).neon).toBe(false);
    expect(billboardValues(0.87).neon).toBe(true);
  });

  it('진행도 .5 중간값', () => {
    const bw = easeInOutCubic(0.5 / 0.78);
    const v = billboardValues(0.5);
    expect(v.x).toBeCloseTo((1 - bw) * 55);
    expect(v.fill).toBeCloseTo(easeInOutCubic(0.4 / 0.7));
  });
});

describe('스틱 스윙', () => {
  it('각도', () => {
    expect(swingAngle(0)).toBeCloseTo(-6);
    expect(swingAngle(0.125)).toBeCloseTo(20); // sin(pi/2)=1
    expect(swingAngle(0.375)).toBeCloseTo(-32);
  });

  it('부호와 타격 판정', () => {
    expect(swingSign(0.125)).toBe(1);
    expect(swingSign(0.375)).toBe(-1);
    expect(isStrike(1, -1)).toBe(true);
    expect(isStrike(0, -1)).toBe(true);
    expect(isStrike(-1, -1)).toBe(false);
    expect(isStrike(1, 1)).toBe(false);
    expect(isStrike(-1, 1)).toBe(false);
  });

  it('패드 선택', () => {
    expect([...STRIKE_PAD_SEQUENCE]).toEqual([0, 1, 2, 3, 4, 1, 0, 1]);
    expect(pickStrikePad(0)).toBe(0);
    expect(pickStrikePad(0.3)).toBe(2);
    expect(pickStrikePad(0.5)).toBe(4);
    expect(pickStrikePad(0.99)).toBe(1);
    expect(pickStrikePad(1)).toBe(1);
  });
});

describe('glow 타격', () => {
  it('4번에 한 번 강세', () => {
    expect(isAccentHit(0)).toBe(true);
    expect(isAccentHit(1)).toBe(false);
    expect(isAccentHit(3)).toBe(false);
    expect(isAccentHit(4)).toBe(true);
  });

  it('keyframes와 타이밍', () => {
    const a = glowKeyframes(true);
    expect(a.keyframes[0]).toEqual({ transform: 'scale(1.22)', opacity: 1 });
    expect(a.timing).toEqual({ duration: 340, easing: 'cubic-bezier(.15,.9,.3,1)' });
    const n = glowKeyframes(false);
    expect(n.keyframes[0].transform).toBe('scale(1.1)');
    expect(n.keyframes[1]).toEqual({ transform: 'scale(.97)', opacity: 0.42, offset: 0.55 });
    expect(n.keyframes[2]).toEqual({ transform: 'scale(1)', opacity: 0.5 });
    expect(n.timing.duration).toBe(220);
  });

  it('물결·번쩍임 상수', () => {
    expect(RIPPLE_TIMING).toEqual({ duration: 600, easing: 'ease-out' });
    expect(RIPPLE_REMOVE_MS).toBe(620);
    expect(PAD_FLASH_MS).toBe(160);
  });
});
