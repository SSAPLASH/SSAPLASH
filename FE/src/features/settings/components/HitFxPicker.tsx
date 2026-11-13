// 설정의 타격 이펙트 선택 — [이전] [작은 DrumKit 미리보기] [다음] + 이름·설명·점·n / N. KitSkinCarousel과 같은 사용법.
// 미리보기는 자체 emitter로 스네어·심벌·킥 데모 타격을 약 1.2초 간격으로 보낸다(보일 때만, 모션 줄이기면 멈춤).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useReducedMotion } from 'motion/react';
import { DrumKit } from '@/components/drum/DrumKit';
import { IconButton } from '@/components/ui/action/IconButton';
import type { KitSkin } from '@/domain/kit/drumKit';
import { HIT_FX_THEMES, HIT_FX_THEME_LABELS, hitFxThemeDef } from '@/domain/hitFx/themes';
import type { HitFxTheme } from '@/domain/hitFx/types';
import type { PadId } from '@/domain/kit/pads';
import { createFxEmitter } from '@/components/fx/fxSource';
import './KitSkinCarousel.css';

/** 이전(-1)·다음(1) 테마. 끝에서 넘기면 반대편 끝으로 순환한다 */
export function nextFxTheme(cur: HitFxTheme, dir: 1 | -1): HitFxTheme {
  const n = HIT_FX_THEMES.length;
  const i = HIT_FX_THEMES.indexOf(cur);
  return HIT_FX_THEMES[(i + dir + n) % n] ?? cur;
}

/** 데모 타격 순서와 간격 */
const DEMO_PADS: readonly PadId[] = ['SNARE', 'CRASH', 'KICK'];
export const DEMO_INTERVAL_MS = 1200;
const DEMO_VELOCITY = 105;

interface Props {
  value: HitFxTheme;
  onChange: (next: HitFxTheme) => void;
  /** 미리보기 킷의 드럼 모양 */
  skin: KitSkin;
  /** SettingRow 라벨 id — 그룹 접근 이름으로 이어 준다 */
  labelledBy?: string;
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={dir === 'left' ? 'M11 4 6 9l5 5' : 'M7 4l5 5-5 5'} />
    </svg>
  );
}

export function HitFxPicker({ value, onChange, skin, labelledBy }: Props) {
  const index = Math.max(0, HIT_FX_THEMES.indexOf(value));
  const total = HIT_FX_THEMES.length;
  const reduced = useReducedMotion();
  const emitter = useMemo(() => createFxEmitter(), []);
  const previewRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  // 화면에 보일 때만 데모를 돌린다
  useEffect(() => {
    const el = previewRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setVisible(last.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduced || !visible) return;
    let n = 0;
    let seq = 0;
    const fire = () => {
      emitter.emit({
        seq: ++seq,
        pad: DEMO_PADS[n++ % DEMO_PADS.length] as PadId,
        velocity: DEMO_VELOCITY,
        mode: 'preview',
        judgement: null,
        deltaMs: null,
        combo: null,
      });
    };
    // 테마를 넘긴 직후에도 바로 보이도록 첫 타격은 짧게 기다렸다 친다
    const first = setTimeout(fire, 350);
    const timer = setInterval(fire, DEMO_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [emitter, reduced, visible, value]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(nextFxTheme(value, -1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(nextFxTheme(value, 1));
    }
  };

  return (
    <div
      className="kit-skin-carousel"
      role="group"
      aria-roledescription="carousel"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : '타격 이펙트'}
      onKeyDown={onKeyDown}
    >
      <div className="kit-skin-main">
        <IconButton label="이전 타격 이펙트" className="kit-skin-nav" onClick={() => onChange(nextFxTheme(value, -1))}>
          <Chevron dir="left" />
        </IconButton>
        <div ref={previewRef} className="kit-skin-preview">
          <DrumKit fitContain scale={0.55} skin={skin} labels={false} effects fxTheme={value} fxSource={emitter.source} />
        </div>
        <IconButton label="다음 타격 이펙트" className="kit-skin-nav" onClick={() => onChange(nextFxTheme(value, 1))}>
          <Chevron dir="right" />
        </IconButton>
      </div>
      <div className="kit-skin-meta">
        <span className="kit-skin-name" aria-live="polite">
          {HIT_FX_THEME_LABELS[value]}
        </span>
        <span className="kit-skin-dots" aria-hidden="true">
          {HIT_FX_THEMES.map((t, i) => (
            <span key={t} className={`kit-skin-dot${i === index ? ' active' : ''}`} />
          ))}
        </span>
        <span className="kit-skin-count">{`${index + 1} / ${total}`}</span>
      </div>
      <p className="kit-skin-desc">{hitFxThemeDef(value).description}</p>
    </div>
  );
}
