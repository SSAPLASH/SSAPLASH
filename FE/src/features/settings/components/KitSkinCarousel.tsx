// Figma Controls / KitSkinCarousel — 드럼 모양(스킨) 고르는 캐러셀. [이전] [DrumKit 미리보기] [다음] + 이름·점·n / 3.
// 넘기면 바로 onChange로 알린다(저장 버튼 없음). 값은 props로만 받고 스토어는 모른다.
import type { KeyboardEvent } from 'react';
import { DrumKit } from '@/components/drum/DrumKit';
import { IconButton } from '@/components/ui/action/IconButton';
import { KIT_SKINS, KIT_SKIN_LABELS } from '@/domain/kit/drumKit';
import type { KitSkin } from '@/domain/kit/drumKit';
import './KitSkinCarousel.css';

/** 이전(-1)·다음(1) 스킨. 끝에서 넘기면 반대편 끝으로 순환한다 */
export function nextSkin(cur: KitSkin, dir: 1 | -1): KitSkin {
  const n = KIT_SKINS.length;
  const i = KIT_SKINS.indexOf(cur);
  return KIT_SKINS[(i + dir + n) % n] ?? cur;
}

interface Props {
  value: KitSkin;
  onChange: (next: KitSkin) => void;
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

export function KitSkinCarousel({ value, onChange, labelledBy }: Props) {
  const index = Math.max(0, KIT_SKINS.indexOf(value));
  const total = KIT_SKINS.length;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(nextSkin(value, -1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(nextSkin(value, 1));
    }
  };

  return (
    <div
      className="kit-skin-carousel"
      role="group"
      aria-roledescription="carousel"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : '드럼 모양'}
      onKeyDown={onKeyDown}
    >
      <div className="kit-skin-main">
        <IconButton label="이전 드럼 모양" className="kit-skin-nav" onClick={() => onChange(nextSkin(value, -1))}>
          <Chevron dir="left" />
        </IconButton>
        <div className="kit-skin-preview">
          <DrumKit fitContain scale={0.55} skin={value} labels />
        </div>
        <IconButton label="다음 드럼 모양" className="kit-skin-nav" onClick={() => onChange(nextSkin(value, 1))}>
          <Chevron dir="right" />
        </IconButton>
      </div>
      <div className="kit-skin-meta">
        <span className="kit-skin-name" aria-live="polite">
          {KIT_SKIN_LABELS[value]}
        </span>
        <span className="kit-skin-dots" aria-hidden="true">
          {KIT_SKINS.map((s, i) => (
            <span key={s} className={`kit-skin-dot${i === index ? ' active' : ''}`} />
          ))}
        </span>
        <span className="kit-skin-count">
          {`${index + 1} / ${total}`}
        </span>
      </div>
    </div>
  );
}
