// 반주 진행 막대 (설계 MODE-002 3-11, D11·D13). 네이티브 range 입력을 감싸 누르기·끌기·키보드 탐색을 맡는다.
// 녹음 보관함의 녹음 재생바도 같이 쓴다(읽히는 이름만 `label`로 바꾼다).
// 끄는 동안은 채움과 시간 글자만 따라가고, 손을 떼면 onSeek을 한 번만 부른다. 위치 계산(자르기)은 호출자가 한다.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { formatClock, formatSpoken } from '@/domain/song/freeAccompaniment';
import './SeekBar.css';

/** ←/→ 한 번에 옮기는 간격(ms) */
export const SEEK_STEP_MS = 5000;

interface Props {
  positionMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
  /** inline(기본): 막대 오른쪽에 「경과 / 전체」. ends: 막대 아래 양끝에 경과·남은 시간(손잡이 없이 끄는 동안 막대가 굵어진다). bare: 시간 글자 없이 막대만(3px, 올림 5px, 끌기·키보드 초점 7px) */
  layout?: 'inline' | 'ends' | 'bare';
  /** 화면 낭독기가 읽는 이름(기본 「반주 위치」) */
  label?: string;
}

export function SeekBar({ positionMs, durationMs, onSeek, layout = 'inline', label = '반주 위치' }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const pointerDown = useRef(false);
  const dur = durationMs > 0 ? durationMs : 0;
  // 끄는 중에는 250ms 읽기로 들어오는 위치를 막대에 반영하지 않는다
  const shown = Math.min(Math.max(drag ?? positionMs, 0), dur);
  const pct = dur > 0 ? (shown / dur) * 100 : 0;

  const commit = () => {
    if (!pointerDown.current) return;
    pointerDown.current = false;
    if (drag !== null) onSeek(drag);
    setDrag(null);
  };
  // window 리스너는 등록 시점의 drag를 보므로 최신 commit을 ref로 부른다
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    let to: number | null = null;
    if (e.key === 'ArrowLeft') to = shown - SEEK_STEP_MS;
    else if (e.key === 'ArrowRight') to = shown + SEEK_STEP_MS;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = dur;
    if (to === null) return;
    // 방향키·Home·End만 막대가 쓴다. 문자·숫자(드럼 연주 키)는 건드리지 않는다
    e.preventDefault();
    onSeek(Math.min(Math.max(to, 0), dur));
  };

  return (
    <div className={layout === 'ends' ? 'free-seek is-ends' : layout === 'bare' ? 'free-seek is-bare' : 'free-seek'}>
      <input
        className={`free-seek-range${drag !== null ? ' is-dragging' : ''}`}
        type="range"
        min={0}
        max={dur}
        step={1}
        value={shown}
        style={{ '--free-seek-pct': `${pct}%` } as React.CSSProperties}
        aria-label={label}
        aria-valuetext={`${formatSpoken(shown)} / ${formatSpoken(dur)}`}
        onPointerDown={() => {
          pointerDown.current = true;
          // 막대 밖에서 손을 떼도 끌기를 끝낸다(마우스는 놓은 자리의 요소에 pointerup이 간다)
          window.addEventListener('pointerup', () => commitRef.current(), { once: true });
        }}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (pointerDown.current) setDrag(v);
          else onSeek(v);
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyDown={onKeyDown}
      />
      {layout === 'bare' ? null : layout === 'ends' ? (
        <span className="free-seek-ends num">
          <span>{formatClock(shown)}</span>
          <span>-{formatClock(dur - shown)}</span>
        </span>
      ) : (
        <span className="free-seek-time num">
          {formatClock(shown)} / {formatClock(dur)}
        </span>
      )}
    </div>
  );
}
