// 연주 HUD (Figma PlayHUD 126:3352, 10/31 재구성). 높이 96, 세션 접근 없이 스냅샷을 props로 받는다.
// 일시정지 버튼은 없다(U20, Dock ‖·Esc). 각 수치는 data-stat 요소로 분리해 카운트업 같은 이펙트를 나중에 얹을 수 있게 한다.
import { useState } from 'react';
import { m, useReducedMotion } from 'motion/react';
import type { Difficulty } from '@/domain/chart';
import { LevelBadge } from '@/components/song/LevelBadge';
import { SongCover } from '@/components/song/SongCover';
import './PlayHud.css';

interface BaseProps {
  title: string;
  artist?: string;
  coverUrl?: string | null;
  /** 연습 단계 */
  level: Difficulty;
  bpm?: number;
  elapsedMs: number;
  durationMs: number;
}

interface GameProps extends BaseProps {
  variant: 'game';
  score: number;
  combo: number;
  /** 정확도(%, 0~100). 아직 없으면 null → "—" */
  accuracy: number | null;
}

interface SheetProps extends BaseProps {
  variant: 'sheet';
  perfect: number;
  good: number;
  miss: number;
}

export type PlayHudProps = GameProps | SheetProps;

const DASH = '—';

/** ms → 01:12 */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function progressRatio(elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  return Math.min(1, Math.max(0, elapsedMs / durationMs));
}

interface Stat {
  key: string;
  label: string;
  value: string;
  /** 라벨·숫자 색 클래스 */
  tone: string;
}

function stats(p: PlayHudProps): Stat[] {
  if (p.variant === 'game') {
    return [
      { key: 'score', label: '점수', value: Math.round(p.score).toLocaleString('en-US'), tone: 'brand' },
      { key: 'combo', label: '콤보', value: String(p.combo), tone: '' },
      { key: 'accuracy', label: '정확도', value: p.accuracy === null ? DASH : `${p.accuracy.toFixed(1)}%`, tone: '' },
    ];
  }
  return [
    { key: 'perfect', label: 'PERFECT', value: String(p.perfect), tone: 'perfect' },
    { key: 'good', label: 'GOOD', value: String(p.good), tone: 'good' },
    { key: 'miss', label: 'MISS', value: String(p.miss), tone: 'miss' },
  ];
}

/** 콤보 범프 크기·시간(E5) */
const BUMP_SCALE = [1, 1.18, 1];
const BUMP_SEC = 0.16;

/** E5 콤보 숫자: 값이 오를 때만 범프(scale 1→1.18→1). 10의 배수로 오르면 브랜드색으로 번쩍. 내려가면(0 포함) 없음 */
function ComboValue({ combo }: { combo: number }) {
  const reduced = useReducedMotion();
  const [prev, setPrev] = useState(combo);
  const [bump, setBump] = useState(0);
  const [flash, setFlash] = useState(false);
  if (combo !== prev) {
    setPrev(combo);
    const up = combo > prev;
    if (up) setBump(bump + 1);
    setFlash(up && combo % 10 === 0);
  }
  const active = bump > 0 && !reduced;
  return (
    <m.span
      // key가 바뀌면 재마운트돼 연속 상승마다 처음부터 다시 재생한다
      key={bump}
      className={flash && !reduced ? 'play-hud-value combo-flash' : 'play-hud-value'}
      data-bump={active ? bump : undefined}
      data-stat="combo"
      animate={active ? { scale: BUMP_SCALE } : undefined}
      transition={{ duration: BUMP_SEC, ease: 'easeOut' }}
    >
      {combo}
    </m.span>
  );
}

export function PlayHud(props: PlayHudProps) {
  const { variant, title, artist, coverUrl = null, level, bpm, elapsedMs, durationMs } = props;
  const ratio = progressRatio(elapsedMs, durationMs);
  return (
    <div className={`play-hud ${variant}`}>
      <div className="play-hud-info">
        <div className="play-hud-cover">
          <SongCover coverUrl={coverUrl} />
        </div>
        <div className="play-hud-text">
          <div className="play-hud-titleline">
            <h1 className="play-hud-title" data-focus-title tabIndex={-1}>
              {title}
            </h1>
            <LevelBadge level={level} />
            {bpm !== undefined && <span className="play-hud-bpm">BPM {Math.round(bpm)}</span>}
          </div>
          {artist && <p className="play-hud-artist">{artist}</p>}
          <div className="play-hud-progress">
            <div
              className="play-hud-bar"
              role="progressbar"
              aria-label="곡 진행"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(ratio * 100)}
            >
              <div className="play-hud-bar-fill" style={{ width: `${ratio * 100}%` }} />
            </div>
            <span className="play-hud-time">
              {clock(elapsedMs)} / {clock(durationMs)}
            </span>
          </div>
        </div>
      </div>
      <div className="play-hud-stats">
        {stats(props).map((s) => (
          <div key={s.key} className={`play-hud-stat ${s.tone}`}>
            <span className="play-hud-label">{s.label}</span>
            {s.key === 'combo' && props.variant === 'game' ? (
              <ComboValue combo={props.combo} />
            ) : (
              <span className="play-hud-value" data-stat={s.key}>
                {s.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
