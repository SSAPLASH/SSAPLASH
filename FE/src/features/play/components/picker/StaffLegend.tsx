// 악보 읽는 법 카드 (Figma 378:12946, 설계 10/31 결정 ④). 오선 위치 → 패드 9칸 2열 카드 + 기호 설명 칸.
// 세로 목록 모양은 없앴다. 되돌리려면 git 이력·Figma 10 섹션 시안 913:44073을 본다.
// 기호 위치·모양은 domain/song/sheet의 staffPosOf를 그대로 쓴다(악보와 어긋나지 않게 표를 새로 만들지 않는다). props만 받는다.
import type { CSSProperties } from 'react';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { staffPosOf, type NoteHead } from '@/domain/song/sheet';
import './staff-legend.css';

/** 위에서부터 보여 주는 순서(악보 위치 높은 순) */
const LEGEND_PADS: PadId[] = ['CRASH', 'HIHAT', 'RIDE', 'SMALL_TOM', 'MID_TOM', 'SNARE', 'FLOOR_TOM', 'KICK', 'HIHAT_PEDAL'];

const SVG_W = 64;
const SVG_H = 44;
/** 선1(pos 0)의 y. 반 칸(pos 1) = 3px, 선 간격 6px */
const BOTTOM_Y = 36;
const HALF = 3;
const CX = 32;

const ORDINAL = ['첫째', '둘째', '셋째', '넷째', '다섯째'];

/** 보표 위치를 말로 풀어 쓴다. 짝수 = 줄, 홀수 = 칸 */
function staffPosText(line: number): string {
  if (line >= 10) return '오선 위 덧줄';
  if (line === 9) return '오선 맨 위 줄 위';
  if (line % 2 === 0) return `오선 ${ORDINAL[line / 2]} 줄`;
  return `오선 ${ORDINAL[(line - 1) / 2]} 칸`;
}

/** 카드용 짧은 위치 글: 「오선 」 접두를 뺀다(덧줄·맨 위 줄 위는 그대로) */
function staffPosShort(line: number): string {
  if (line >= 10) return '오선 위 덧줄';
  return staffPosText(line).replace(/^오선 /, '');
}

function Head({ head, y }: { head: NoteHead; y: number }) {
  if (head === 'normal') return <ellipse className="play-sl-sym fill" cx={CX} cy={y} rx={4.5} ry={3.2} />;
  const d = 3.5;
  return (
    <g className="play-sl-sym">
      <line x1={CX - d} y1={y - d} x2={CX + d} y2={y + d} />
      <line x1={CX - d} y1={y + d} x2={CX + d} y2={y - d} />
      {head === 'circle-cross' && <circle cx={CX} cy={y} r={6} />}
    </g>
  );
}

/** 오선을 키우는 배율(viewBox는 그대로) */
const GRID_SCALE = 1.4;

function MiniStaff({ pad, scale = 1, color }: { pad: PadId; scale?: number; color?: string }) {
  const { line, head } = staffPosOf(pad);
  const y = BOTTOM_Y - line * HALF;
  return (
    <svg
      className={`play-sl-staff${color ? ' colored' : ''}`}
      style={color ? ({ '--pad-color': color } as CSSProperties) : undefined}
      width={Math.round(SVG_W * scale * 10) / 10}
      height={Math.round(SVG_H * scale * 10) / 10} 
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} className="play-sl-line" x1={0} x2={SVG_W} y1={BOTTOM_Y - i * 2 * HALF} y2={BOTTOM_Y - i * 2 * HALF} />
      ))}
      {line >= 10 && <line className="play-sl-ledger" x1={CX - 9} x2={CX + 9} y1={y} y2={y} />}
      <Head head={head} y={y} />
    </svg>
  );
}

export interface StaffLegendProps {
  /** 강조할 줄(패드 타격 때 부모가 짧게 넘긴다) */
  activePad?: PadId;
  /** 동시에 강조할 줄들(안내 애니메이션의 같은 칸 패드). activePad와 합쳐 모두 강조한다 */
  activePads?: readonly PadId[];
  /** 줄에 마우스를 올리거나 포커스하면 그 패드, 벗어나면 null */
  onHoverPad?: (pad: PadId | null) => void;
  className?: string;
}

/** 2열 카드(설계 U9 C안): 패드 색 음표 + 이름·짧은 위치·발 표시, 마지막 칸은 기호 설명 */
export function StaffLegend({ activePad, activePads, onHoverPad, className }: StaffLegendProps) {
  return (
    <section className={['play-sl', 'grid', className].filter(Boolean).join(' ')} aria-label="악보 읽는 법">
      <h3 className="play-sl-title">악보 읽는 법</h3>
      <p className="play-sl-desc">음표가 놓인 줄이 칠 패드예요. 색이 같은 패드를 치면 돼요.</p>
      <ul className="play-sl-cells">
        {LEGEND_PADS.map((pad) => {
          const meta = PAD_META[pad];
          const { line } = staffPosOf(pad);
          const active = activePad === pad || activePads?.includes(pad) === true;
          return (
            <li
              key={pad}
              className={`play-sl-cell${active ? ' active' : ''}`}
              style={{ '--pad-color': meta.color } as CSSProperties}
              tabIndex={0}
              aria-label={`${meta.label} — ${staffPosText(line)}, ${meta.stick ? '손' : '발'}${pad === 'HIHAT' ? ', o 열린 하이햇, 페달 떼고 치기' : ''}`}
              onMouseEnter={() => onHoverPad?.(pad)}
              onMouseLeave={() => onHoverPad?.(null)}
              onFocus={() => onHoverPad?.(pad)}
              onBlur={() => onHoverPad?.(null)}
            >
              <span className="play-sl-cell-top">
                <MiniStaff pad={pad} scale={GRID_SCALE} color={meta.color} />
              </span>
              <span className="play-sl-cell-bot">
                <span className="play-sl-name">{meta.label}</span>
                {pad !== 'HIHAT_PEDAL' && <span className="play-sl-pos">{staffPosShort(line)}</span>}
                {!meta.stick && <span className="play-sl-tag foot">발</span>}
              </span>
            </li>
          );
        })}
        <li className="play-sl-key" aria-label="기호 설명">
          <span><b>⊗</b>크래시</span>
          <span><b>×</b>심벌·하이햇 페달</span>
          <span><b>●</b>북·킥</span>
        </li>
      </ul>
      <p className="play-sl-note">칸에 마우스를 올리거나 패드를 치면 아래 킷의 같은 패드와 함께 빛나요.</p>
    </section>
  );
}
