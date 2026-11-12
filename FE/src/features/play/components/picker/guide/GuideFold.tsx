// 곡 선택 안내 접이 바(글래스 바). 얇은 바 한 줄로 안내 줄(PickerGuide)과 구분선을 접고 펼친다.
// 기본은 펼침이고, 접음 여부는 모드별로 localStorage에 기억한다. 접어도 안내는 마운트된 채 두고
// 시계만 멈추며(active=false), 안쪽은 inert라 탭 순서·접근성 트리에서 빠진다.
import { useId, useState } from 'react';
import { PickerGuide } from './PickerGuide';
import './guide-fold.css';

const KEY_PREFIX = 'airdrum.picker.guideFold.';

type Mode = 'play' | 'sheet';

const COPY: Record<Mode, { label: string; summary: string }> = {
  sheet: { label: '악보 연습 안내', summary: '세로선이 음표에 닿을 때, 그 음표가 놓인 줄의 패드를 쳐요' },
  play: { label: '리듬 게임 안내', summary: '노트가 판정선에 닿을 때, 그 레인의 패드를 쳐요' },
};

/** 저장값 '1'만 접힘이다. 값이 없거나 저장소를 못 읽으면 펼침 */
function readOpen(mode: Mode): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + mode) !== '1';
  } catch {
    return true;
  }
}

function writeOpen(mode: Mode, open: boolean): void {
  try {
    localStorage.setItem(KEY_PREFIX + mode, open ? '0' : '1');
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서도 화면은 정상이다
  }
}

export interface GuideFoldProps {
  mode: Mode;
}

export function GuideFold({ mode }: GuideFoldProps) {
  const bodyId = useId();
  const [open, setOpen] = useState(() => readOpen(mode));
  const [seenMode, setSeenMode] = useState(mode);

  // 렌더 중 상태 조정: 모드가 바뀌면 그 모드의 저장값을 따른다(효과 안에서 setState하지 않는다)
  if (mode !== seenMode) {
    setSeenMode(mode);
    setOpen(readOpen(mode));
  }

  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeOpen(mode, next);
  };
  const copy = COPY[mode];

  return (
    <div className={open ? 'guide-fold open' : 'guide-fold'}>
      <button type="button" className="guide-fold-bar" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <span className="guide-fold-ico" aria-hidden="true">
          ?
        </span>
        <span className="guide-fold-label">{copy.label}</span>
        <span className="guide-fold-sum">{copy.summary}</span>
        <span className="guide-fold-act">
          {open ? '접기' : '펼치기'}
          <svg className="guide-fold-chev" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      <div className="guide-fold-body" id={bodyId}>
        <div className="guide-fold-inner" inert={!open}>
          <div className="guide-fold-content">
            <PickerGuide mode={mode} active={open} />
            <hr className="play-sp-divider" />
          </div>
        </div>
      </div>
    </div>
  );
}
