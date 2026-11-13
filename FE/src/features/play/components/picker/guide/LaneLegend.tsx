// 레인 읽는 법 카드 (설계 MODE-001-MODE-003-song-picker-guide 2차 U25). 악보 읽는 법(StaffLegend)과 같은 2열 카드 모양.
// 미니 오선 자리에 미니 레인 띠(하이햇 페달 칸은 떼어 둠, 이 레인만 색 + 번짐) · 이름 · 레인 위치 · 발 표시. 마지막 칸은 색 설명.
// 칸 순서는 실제 하이웨이 레인 순서(HIGHWAY_LANES), 색은 게임 노트와 같은 네온 3색(laneColorOf). props만 받는다.
import type { CSSProperties } from 'react';
import { HIGHWAY_LANES, LANE_COLOR, laneColorOf } from '@/features/play/domain/highwayLanes';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import '@/features/play/components/picker/staff-legend.css';
import './lane-legend.css';

/** 미니 레인 띠 viewBox. 하이햇 페달 칸은 맨 왼쪽에 떼어 두고 나머지 8칸을 이어 붙인다 */
const SVG_W = 64;
const SVG_H = 44;
const BAR_W = 5.2;
const MAIN_X0 = 10;
const MAIN_PITCH = 6.7;

function barX(i: number): number {
  return i === 0 ? 1 : MAIN_X0 + (i - 1) * MAIN_PITCH;
}

/** 레인 위치 말: 맨 왼쪽(페달) · n번째(왼쪽에서 페달을 뺀 n번째) */
function lanePosText(index: number): string {
  return index === 0 ? '맨 왼쪽' : `${index}번째`;
}

function laneAriaLabel(pad: PadId, index: number): string {
  const meta = PAD_META[pad];
  const how = meta.stick ? '손' : '발';
  return index === 0 ? `${meta.label} — 맨 왼쪽 따로 떨어진 레인, ${how}` : `${meta.label} — 왼쪽에서 ${index}번째 레인, ${how}`;
}

function MiniLanes({ index }: { index: number }) {
  return (
    <svg className="play-sl-lanes" width={89.6} height={61.6} viewBox={`0 0 ${SVG_W} ${SVG_H}`} aria-hidden="true">
      {HIGHWAY_LANES.map((pad, i) => (
        <rect key={pad} className={i === index ? 'on' : 'off'} x={barX(i)} y={6} width={BAR_W} height={28} rx={1.5} />
      ))}
      <line className="base" x1={0} x2={7} y1={38} y2={38} />
      <line className="base" x1={9} x2={SVG_W} y1={38} y2={38} />
    </svg>
  );
}

export interface LaneLegendProps {
  /** 강조할 칸들(안내 애니메이션의 같은 칸 패드) */
  activePads?: readonly PadId[];
  /** 칸에 마우스를 올리거나 포커스하면 그 패드, 벗어나면 null */
  onHoverPad?: (pad: PadId | null) => void;
  className?: string;
}

export function LaneLegend({ activePads, onHoverPad, className }: LaneLegendProps) {
  return (
    <section className={['play-sl', 'grid', className].filter(Boolean).join(' ')} aria-label="레인 읽는 법">
      <h3 className="play-sl-title">레인 읽는 법</h3>
      <p className="play-sl-desc">노트가 떨어지는 레인이 칠 패드예요. 레인은 드럼이 놓인 순서대로 왼쪽부터 있어요.</p>
      <ul className="play-sl-cells">
        {HIGHWAY_LANES.map((pad, index) => {
          const meta = PAD_META[pad];
          const active = activePads?.includes(pad) === true;
          return (
            <li
              key={pad}
              className={`play-sl-cell${active ? ' active' : ''}`}
              style={{ '--pad-color': laneColorOf(pad) } as CSSProperties}
              tabIndex={0}
              aria-label={laneAriaLabel(pad, index)}
              onMouseEnter={() => onHoverPad?.(pad)}
              onMouseLeave={() => onHoverPad?.(null)}
              onFocus={() => onHoverPad?.(pad)}
              onBlur={() => onHoverPad?.(null)}
            >
              <span className="play-sl-cell-top">
                <MiniLanes index={index} />
              </span>
              <span className="play-sl-cell-bot">
                <span className="play-sl-name">{meta.label}</span>
                <span className="play-sl-pos">{lanePosText(index)}</span>
                {!meta.stick && <span className="play-sl-tag foot">발</span>}
              </span>
            </li>
          );
        })}
        <li className="play-sl-key" aria-label="색 설명">
          <span>
            <i style={{ background: LANE_COLOR.cymbal, color: LANE_COLOR.cymbal }} />
            심벌
          </span>
          <span>
            <i style={{ background: LANE_COLOR.drum, color: LANE_COLOR.drum }} />북
          </span>
          <span>
            <i style={{ background: LANE_COLOR.kick, color: LANE_COLOR.kick }} />킥
          </span>
        </li>
      </ul>
      <p className="play-sl-note">칸에 마우스를 올리면 왼쪽 장면의 같은 레인과 패드가 빛나요.</p>
    </section>
  );
}
