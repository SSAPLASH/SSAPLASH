// 악보 연습 안내 장면 (설계 MODE-001-MODE-003-song-picker-guide 2장, 11/10 악보 모드 목업).
// 위: 악보 한 마디(보표·마디선·박자표·기둥·빔·머리·커서·박 라벨) SVG. 아래: 실제 DrumKit(사용자 kitSkin, 전자·네온 0.85배 · 실물은 위에서 본 그림을 같은 칸에 맞춤, guideKitPlace).
// 연결선·음표 고리는 킷 위에 겹치는 SVG(pointer-events none). 논리 좌표 760×470 한 판을 CSS 비율로 줄인다.
// 악보 색·굵기는 sheetStripDraw와 같은 토큰. 패드 중심은 kitPadsFor(skin)에서 계산한다. 소리·이펙트 없음.
import { memo, useMemo, useState } from 'react';
import { DrumKit } from '@/components/drum/DrumKit';
import { kitPadsFor, padCenter, type PadVisualState } from '@/domain/kit/drumKit';
import { guideKitPlace } from './guideKitPlace';
import { CURSOR_END_POS, CURSOR_START_POS, EXAMPLE_STEPS, STEPS_PER_BAR, type GuideState } from '@/features/play/domain/guideScript';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { staffPosOf, type NoteHead } from '@/domain/song/sheet';
import { useSettings } from '@/store/settingsStore';
import './guide.css';

// 장면 논리 좌표(px)
export const SCENE_W = 760;
export const SCENE_H = 470;
const L = 90; // 마디 왼쪽 선
const R = 740; // 마디 오른쪽 선
const BOT = 130; // 선1 y
const HALF = 5; // 보표 위치 1단위(반 칸) = 5px (sheetStripDraw LINE_GAP 10)
const X0 = L + 28; // 첫 음표 x
const SPAN = R - L - 50; // 첫 음표 ~ 마디 끝(8칸) 폭
const STEM_DX = 5.25;
const STEM_LEN = 30;

const yOf = (pos: number) => BOT - pos * HALF;
const xOf = (beat: number) => X0 + (SPAN * beat) / STEPS_PER_BAR;
/** progress(0~1) → 커서 x. 커서 시작·끝 위치(8분 단위)를 장면 px로 편다 */
const cursorX = (progress: number) => xOf(CURSOR_START_POS + progress * (CURSOR_END_POS - CURSOR_START_POS));

interface Col {
  i: number;
  x: number;
  pads: PadId[];
  stemTop: number;
}
const COLS: Col[] = EXAMPLE_STEPS.map((s, i) => ({
  i,
  x: xOf(s.beat),
  pads: s.pads,
  stemTop: yOf(Math.max(...s.pads.map((p) => staffPosOf(p).line))) - STEM_LEN,
}));

function Glyph({ head, x, y, s, cls }: { head: NoteHead; x: number; y: number; s: number; cls: string }) {
  if (head === 'normal') return <ellipse className={`${cls} fill`} cx={x} cy={y} rx={4.5 * s} ry={3.2 * s} />;
  const d = 3.5 * s;
  return (
    <g className={cls}>
      <line x1={x - d} y1={y - d} x2={x + d} y2={y + d} />
      <line x1={x - d} y1={y + d} x2={x + d} y2={y - d} />
      {head === 'circle-cross' && <circle cx={x} cy={y} r={6 * s} />}
    </g>
  );
}

/** 바뀌지 않는 악보 바탕: 보표 5선·마디선·박자표·마디 번호·기둥·빔 */
const StaffStatic = memo(function StaffStatic() {
  const pairs = Array.from({ length: Math.floor(COLS.length / 2) }, (_, b) => [COLS[2 * b], COLS[2 * b + 1]] as const);
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} className="guide-st-line" x1={20} x2={750} y1={yOf(i * 2)} y2={yOf(i * 2)} />
      ))}
      <line className="guide-st-bar" x1={L} x2={L} y1={yOf(8)} y2={yOf(0)} />
      <line className="guide-st-bar" x1={R} x2={R} y1={yOf(8)} y2={yOf(0)} />
      <text className="guide-st-num" x={L + 4} y={40}>
        1
      </text>
      <text className="guide-st-sig" x={L - 22} y={yOf(6)}>
        4
      </text>
      <text className="guide-st-sig" x={L - 22} y={yOf(2)}>
        4
      </text>
      {COLS.map((c) => (
        <line
          key={c.i}
          className="guide-st-ink"
          x1={c.x + STEM_DX}
          x2={c.x + STEM_DX}
          y1={yOf(Math.min(...c.pads.map((p) => staffPosOf(p).line)))}
          y2={c.stemTop}
        />
      ))}
      {pairs.map(([a, z]) => {
        const yb = Math.min(a.stemTop, z.stemTop);
        return (
          <g key={a.i}>
            {[a, z].map((c) => (
              <line key={c.i} className="guide-st-ink" x1={c.x + STEM_DX} x2={c.x + STEM_DX} y1={c.stemTop} y2={yb} />
            ))}
            <rect className="guide-st-beam" x={a.x + 4.5} y={yb} width={z.x - a.x + 1.5} height={3} />
          </g>
        );
      })}
    </>
  );
});

/** DrumKit은 states·hitSeq가 바뀔 때만 다시 그린다(커서가 프레임마다 움직여도 킷은 그대로) */
const MemoKit = memo(DrumKit);

export interface SheetGuideSceneProps {
  state: GuideState;
  /** 악보 읽는 법 카드 줄에 올린 패드. 킷에서 그 패드를 예고(armed) 모양으로 강조한다 */
  hoverPad?: PadId | null;
}

export function SheetGuideScene({ state, hoverPad }: SheetGuideSceneProps) {
  const skin = useSettings((s) => s.kitSkin);
  const { active, done } = state;

  // 칸이 바뀔 때마다 타격 모션을 다시 재생한다: 칸이 바뀌면 hitSeq를 올린다(렌더 중 상태 맞춤)
  const [seenActive, setSeenActive] = useState<number | null>(null);
  const [seq, setSeq] = useState(0);
  if (active !== seenActive) {
    setSeenActive(active);
    if (active !== null) setSeq((n) => n + 1);
  }

  const activePads = useMemo(() => (active === null ? [] : COLS[active].pads), [active]);
  const states = useMemo(() => {
    const m: Partial<Record<PadId, PadVisualState>> = {};
    if (hoverPad) m[hoverPad] = 'armed';
    activePads.forEach((p) => (m[p] = 'hit'));
    return m;
  }, [activePads, hoverPad]);
  const hitSeq = useMemo(() => Object.fromEntries(activePads.map((p) => [p, seq])) as Partial<Record<PadId, number>>, [activePads, seq]);

  // 연결선 끝: 패드 헤드 중심(킷 원본 좌표 → 장면 좌표). 하드코딩하지 않고 스킨별 배치표에서 읽는다
  const place = guideKitPlace(skin);
  const kitPads = kitPadsFor(skin, place.view);
  const links =
    active === null
      ? []
      : COLS[active].pads.flatMap((pad) => {
          const kp = kitPads.find((p) => p.pad === pad);
          if (!kp) return [];
          const c = padCenter(kp);
          const tx = place.x + c.x * place.scale;
          const ty = place.y + c.y * place.scale;
          const nx = COLS[active].x;
          const ny = yOf(staffPosOf(pad).line);
          return [{ pad, d: `M${nx},${ny + 12} C${nx},${ny + 90} ${tx},${ty - 110} ${tx},${ty - 22}` }];
        });

  const cx = cursorX(state.progress);
  const tb = (cx - X0) / SPAN;
  const showBeat = tb >= -0.01 && tb < 1;
  const beatNo = Math.min(3, Math.floor(Math.max(0, tb) * 4 + 0.001)) + 1;

  return (
    <div className="guide-scene" data-no-pointer-strike="">
      <div
        className="guide-scene-kit"
        style={{
          left: `${(place.x / SCENE_W) * 100}%`,
          top: `${(place.y / SCENE_H) * 100}%`,
          width: `${(place.w / SCENE_W) * 100}%`,
        }}
      >
        <MemoKit scale={place.scale} view={place.view} skin={skin} states={states} hitSeq={hitSeq} effects={false} />
      </div>
      <svg
        className="guide-scene-svg"
        viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
        role="img"
        aria-label="예시 악보 한 마디와 드럼 킷. 커서가 음표에 닿으면 연결선으로 이어진 패드가 빛난다"
      >
        <StaffStatic />
        {COLS.map((c) =>
          c.pads.map((pad) => {
            const { line, head } = staffPosOf(pad);
            const y = yOf(line);
            const hit = active === c.i;
            const isDone = done.has(c.i) && !hit;
            return (
              <g key={`${c.i}-${pad}`} className={`guide-note${hit ? ' hit' : ''}${isDone ? ' done' : ''}`}>
                {line >= 10 && <line className="guide-st-line" x1={c.x - 10} x2={c.x + 10} y1={y} y2={y} />}
                <circle className="guide-note-ring" cx={c.x} cy={y} r={12} stroke={PAD_META[pad].color} />
                {head === 'normal' ? (
                  <ellipse className="guide-sym fill" cx={c.x} cy={y} rx={6} ry={4.5} transform={`rotate(-20 ${c.x} ${y})`} />
                ) : (
                  <Glyph head={head} x={c.x} y={y} s={1.3} cls="guide-sym" />
                )}
              </g>
            );
          }),
        )}
        <line className="guide-cursor" x1={cx} x2={cx} y1={yOf(8) - 30} y2={yOf(0) + 40} />
        {showBeat && (
          <>
            <text className="guide-beat-n" x={cx + 12} y={186}>
              {beatNo}
            </text>
            <text className="guide-beat-u" x={cx + 30} y={186}>
              박
            </text>
          </>
        )}
        {links.map((l) => (
          <path key={`${active}-${l.pad}`} className="guide-link" d={l.d} stroke={PAD_META[l.pad].color} />
        ))}
      </svg>
    </div>
  );
}
