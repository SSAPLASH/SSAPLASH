// 리듬 게임 안내 장면 (설계 MODE-001-MODE-003-song-picker-guide 2차, 11/11 게임 목업).
// 위: 9레인 띠(하이햇 페달 칸은 떼어 둠)에서 노트가 떨어져 판정선에 닿으면 그 레인이 빛난다.
// 아래: 네온 킷(DRUM_KIT_FLAT_PADS 좌표·NeonPad 그림). 닿은 레인 → 같은 패드로 점선이 이어지고 패드가 번쩍인다.
// 킷은 사용자 kitSkin과 무관하게 네온으로 그린다(게임 노트 색과 같은 3색). 논리 좌표 760×470 한 판을 CSS 비율로 줄인다. 소리 없음.
import { memo, useId, useMemo, useState, type CSSProperties } from 'react';
import { NeonPad } from '@/components/drum/NeonPad';
import { highwayLayout, laneLeft } from '@/features/play/components/stage/highway/highwayGeometry';
import { DRUM_KIT_FLAT_PADS, visualPadOf, type PadVisualState } from '@/domain/kit/drumKit';
import { EXAMPLE_STEPS, GAME_GUIDE_OPTIONS, type GuideState } from '@/features/play/domain/guideScript';
import { HIGHWAY_LANES, LANE_COLOR, laneColorOf, laneGroupOf, type LaneGroup } from '@/features/play/domain/highwayLanes';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import '@/components/drum/drum.css';
import './guide.css';

// 장면 논리 좌표(px)
export const GAME_SCENE_W = 760;
export const GAME_SCENE_H = 470;
const X0 = 96; // 레인 띠 왼쪽
const STRIP_W = 568; // 레인 띠 전체 폭(페달 칸 + 간격 + 8칸)
const STRIP_TOP = 6; // 띠 윗변
const TOP = 34; // 노트가 보이는 맨 위
const LINE = 160; // 판정선 y
const STEP = 32; // 8분 한 칸이 떨어지는 거리
const NOTE_H = 12;
/** 킷: 760×300 원본을 0.85배로 (57, 190)에 둔다 */
const KIT_X = 57;
const KIT_Y = 190;
const KIT_SCALE = 0.85;

/** 레인 띠 좌표는 실제 하이웨이(highwayGeometry)와 같은 함수로 계산한다 */
const LAYOUT = highwayLayout(STRIP_W, 0, HIGHWAY_LANES.length);
const LANE_W = LAYOUT.laneW;
const leftOf = (pad: PadId) => X0 + laneLeft(LAYOUT, HIGHWAY_LANES.indexOf(pad));
const centerOf = (pad: PadId) => leftOf(pad) + LANE_W / 2;
const PEDAL_LEFT = X0 + laneLeft(LAYOUT, 0);
const MAIN_LEFT = X0 + laneLeft(LAYOUT, 1);
const STRIP_RIGHT = X0 + STRIP_W;

/** 진행 위치(8분 단위) 범위: progress(0~1)를 게임 시간표의 시작·끝 위치로 편다 */
const START_POS = GAME_GUIDE_OPTIONS.startPos ?? 0;
const END_POS = GAME_GUIDE_OPTIONS.endPos ?? 0;

const NEON_GROUPS = Object.keys(LANE_COLOR) as LaneGroup[];
/** 킷 패드: 원 중심(장면 좌표)과 반지름 */
const KIT_PADS = DRUM_KIT_FLAT_PADS.map((kp) => ({
  kp,
  ox: KIT_X + (kp.left + kp.w / 2) * KIT_SCALE,
  oy: KIT_Y + (kp.top + kp.h / 2) * KIT_SCALE,
  r: (kp.w / 2) * KIT_SCALE,
}));

/** 노트 목록: 예시 한 마디의 칸 × 패드 */
const NOTES = EXAMPLE_STEPS.flatMap((s, col) => s.pads.map((pad) => ({ col, beat: s.beat, pad })));

const vars = (c: string) => ({ '--c': c }) as CSSProperties;

/** 킷은 states·hitSeq가 바뀔 때만 다시 그린다(노트가 프레임마다 움직여도 킷은 그대로) */
const KitView = memo(function KitView({
  states,
  hitSeq,
}: {
  states: Partial<Record<PadId, PadVisualState>>;
  hitSeq: Partial<Record<PadId, number>>;
}) {
  return (
    <>
      {KIT_PADS.map(({ kp, ox, oy }) => {
        const s = (kp.w / 160) * KIT_SCALE;
        const meta = PAD_META[kp.pad];
        const st = states[kp.pad] ?? 'idle';
        return (
          <g
            key={kp.pad}
            className="drum-pad"
            data-state={st}
            data-shape={kp.shape}
            data-skin="neon"
            data-pad={kp.pad}
            transform={`translate(${ox - 80 * s} ${oy - 80 * s}) scale(${s})`}
          >
            <NeonPad shape={kp.shape} state={st} defsId="guide-neon" tag={meta.short} label={meta.label} labelVisible hitKey={hitSeq[kp.pad]} />
          </g>
        );
      })}
    </>
  );
});

export interface GameGuideSceneProps {
  state: GuideState;
  /** 레인 읽는 법 카드 칸에 올린 패드. 그 레인을 예고 모양으로, 킷의 그 패드를 armed로 강조한다 */
  hoverPad?: PadId | null;
}

export function GameGuideScene({ state, hoverPad }: GameGuideSceneProps) {
  const gid = useId().replace(/:/g, '');
  const { active, done, progress } = state;

  // 칸이 바뀔 때마다 타격 모션을 다시 재생한다: 칸이 바뀌면 hitSeq를 올린다(렌더 중 상태 맞춤)
  const [seenActive, setSeenActive] = useState<number | null>(null);
  const [seq, setSeq] = useState(0);
  if (active !== seenActive) {
    setSeenActive(active);
    if (active !== null) setSeq((n) => n + 1);
  }

  const activePads = useMemo<PadId[]>(() => (active === null ? [] : EXAMPLE_STEPS[active].pads), [active]);
  const activeKit = useMemo(() => activePads.map((p) => visualPadOf(p) ?? p), [activePads]);
  const hoverKit = hoverPad ? visualPadOf(hoverPad) : null;

  const states = useMemo(() => {
    const m: Partial<Record<PadId, PadVisualState>> = {};
    if (hoverKit) m[hoverKit] = 'armed';
    activeKit.forEach((p) => (m[p] = 'hit'));
    return m;
  }, [activeKit, hoverKit]);
  const hitSeq = useMemo(() => Object.fromEntries(activeKit.map((p) => [p, seq])) as Partial<Record<PadId, number>>, [activeKit, seq]);

  const pos = START_POS + progress * (END_POS - START_POS);

  // 연결선: 판정선에 닿은 레인 → 킷 패드 윗선. 하이햇 페달이면 페달 레인에서 하이햇 패드로
  const links = KIT_PADS.flatMap(({ kp, ox, oy, r }) => {
    if (!activeKit.includes(kp.pad)) return [];
    const lanePad = activePads.find((p) => visualPadOf(p) === kp.pad);
    if (!lanePad) return [];
    const x = centerOf(lanePad);
    return [{ pad: kp.pad, lanePad, d: `M${x},${LINE + 6} C${x},${LINE + 40} ${ox},${oy - r - 50} ${ox},${oy - r - 4}` }];
  });

  return (
    <div className="guide-scene" data-no-pointer-strike="">
      <svg
        className="guide-scene-svg"
        viewBox={`0 0 ${GAME_SCENE_W} ${GAME_SCENE_H}`}
        role="img"
        aria-label="떨어지는 노트와 드럼 킷. 노트가 판정선에 닿으면 같은 패드가 빛난다"
      >
        <defs>
          <clipPath id={`${gid}-clip`}>
            <rect x={0} y={TOP - 6} width={GAME_SCENE_W} height={LINE - TOP + 6 + NOTE_H / 2} />
          </clipPath>
          {NEON_GROUPS.map((g) => (
            <linearGradient key={g} id={`${gid}-${g}`} x1={0} y1={0} x2={0} y2={1}>
              <stop offset={0} stopColor={LANE_COLOR[g]} stopOpacity={0} />
              <stop offset={1} stopColor={LANE_COLOR[g]} stopOpacity={0.4} />
            </linearGradient>
          ))}
        </defs>

        {/* 레인 띠(하이햇 페달 칸은 떼어 따로) · 구분선 · 레인 머리 약어 · 판정선 */}
        <rect className="guide-strip-bg" x={PEDAL_LEFT} y={STRIP_TOP} width={LANE_W} height={LINE} rx={8} />
        <rect className="guide-strip-bg" x={MAIN_LEFT} y={STRIP_TOP} width={LANE_W * 8} height={LINE} rx={8} />
        {HIGHWAY_LANES.map((pad, i) => {
          const x = leftOf(pad);
          const on = activePads.includes(pad);
          const hov = !on && hoverPad === pad;
          return (
            <g key={pad} data-lane={pad}>
              {i > 1 && <line className="guide-strip-sep" x1={x} x2={x} y1={STRIP_TOP} y2={LINE + STRIP_TOP} />}
              <rect
                className={`guide-lane-flash${on ? ' on' : ''}${hov ? ' hov' : ''}`}
                x={x + 1}
                y={TOP}
                width={LANE_W - 2}
                height={LINE - TOP}
                fill={`url(#${gid}-${laneGroupOf(pad)})`}
              />
              <text className={`guide-lane-tag${on || hoverPad === pad ? ' on' : ''}`} x={x + LANE_W / 2} y={24} style={vars(laneColorOf(pad))}>
                {PAD_META[pad].short}
              </text>
            </g>
          );
        })}
        <line className="guide-judge" x1={PEDAL_LEFT} x2={PEDAL_LEFT + LANE_W} y1={LINE} y2={LINE} />
        <line className="guide-judge" x1={MAIN_LEFT} x2={STRIP_RIGHT} y1={LINE} y2={LINE} />
        <text className="guide-judge-cap" x={STRIP_RIGHT + 8} y={LINE + 4}>
          판정선
        </text>

        {/* 네온 킷 */}
        <KitView states={states} hitSeq={hitSeq} />

        {/* 연결선: 레인 → 패드 */}
        {links.map((l) => (
          <path key={`${active}-${l.pad}`} className="guide-link" d={l.d} stroke={laneColorOf(l.lanePad)} />
        ))}

        {/* 노트: 레인 색 막대. 활성 칸은 판정선에 붙고, 친 칸은 사라진다. 판정선 아래로는 잘린다 */}
        <g clipPath={`url(#${gid}-clip)`}>
          {NOTES.map((n) => {
            const on = n.col === active;
            const y = on ? LINE : LINE - (n.beat - pos) * STEP;
            const w = LANE_W - 12;
            const gone = done.has(n.col) && !on;
            return (
              <rect
                key={`${n.col}-${n.pad}`}
                className={`guide-gnote${on ? ' on' : ''}`}
                data-note={n.pad}
                x={centerOf(n.pad) - w / 2}
                y={y - NOTE_H / 2}
                width={w}
                height={NOTE_H}
                rx={4}
                style={{ ...vars(laneColorOf(n.pad)), opacity: gone ? 0 : 1 }}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
