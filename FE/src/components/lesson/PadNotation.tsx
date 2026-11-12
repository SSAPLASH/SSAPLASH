// 레슨 카드의 음표 (설계 SETUP-입문-코스 3-5). 패드마다 오선 위 음표 하나와 이름·치는 손발.
// 위치·머리 모양은 악보 화면과 같은 staffPosOf를 써서 실제 악보와 항상 같다.
import { useEffect, useRef } from 'react';
import { PAD_META, type PadId } from '@/domain/pads';
import { staffPosOf } from '@/domain/sheet';
import { PAD_LIMB } from '@/domain/play/lesson';

const GAP = 10; // 선 간격(px). 보표 위치 1단위(반 칸) = 5px
const COL = 104;
const SIDE = 18;
/** 오선 맨 위 선 y. 위쪽은 덧줄·기둥 자리 */
const TOP = 46;
const BOTTOM = TOP + GAP * 4;
const yOf = (pos: number) => BOTTOM - pos * (GAP / 2);

/** 오선 위 음표 하나. 알아보기 화면도 같은 모양을 쓴다 */
function StaffHead({ pad, x }: { pad: PadId; x: number }) {
  const { line, head } = staffPosOf(pad);
  const y = yOf(line);
  const ledger = line >= 10 ? <line className="lesson-staff-line" x1={x - 10} x2={x + 10} y1={yOf(10)} y2={yOf(10)} /> : null;
  if (head === 'normal') {
    const down = line < 4;
    return (
      <g className="lesson-note">
        {ledger}
        <ellipse cx={x} cy={y} rx={6.2} ry={4.4} transform={`rotate(-20 ${x} ${y})`} />
        <line x1={down ? x - 5.6 : x + 5.6} x2={down ? x - 5.6 : x + 5.6} y1={down ? y + 1 : y - 1} y2={down ? y + 28 : y - 28} strokeWidth={1.5} />
      </g>
    );
  }
  return (
    <g className="lesson-note lesson-note-cross">
      {ledger}
      {head === 'circle-cross' && <circle cx={x} cy={y} r={7} fill="none" strokeWidth={1.4} />}
      <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} strokeWidth={1.8} />
      <line x1={x - 5} y1={y + 5} x2={x + 5} y2={y - 5} strokeWidth={1.8} />
      <line x1={x + 5} y1={y - 5} x2={x + 5} y2={y - 28} strokeWidth={1.5} />
    </g>
  );
}

export function PadNotation({ pads }: { pads: readonly PadId[] }) {
  const width = SIDE * 2 + COL * pads.length;
  const height = BOTTOM + 56;
  const names = pads.map((p) => PAD_META[p].label).join(', ');
  return (
    <div className="lesson-staff">
      <svg width={width * NOTATION_ZOOM} height={height * NOTATION_ZOOM} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`악보 위치: ${names}`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} className="lesson-staff-line" x1={6} x2={width - 6} y1={TOP + GAP * i} y2={TOP + GAP * i} />
        ))}
        {pads.map((pad, i) => {
          const x = SIDE + COL * i + COL / 2;
          return (
            <g key={pad} data-pad={pad}>
              <StaffHead pad={pad} x={x} />
              <text className="lesson-staff-name" x={x} y={BOTTOM + 30} textAnchor="middle">
                {PAD_META[pad].label}
              </text>
              <text className="lesson-staff-limb" x={x} y={BOTTOM + 48} textAnchor="middle">
                {PAD_LIMB[pad]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const READ_COL = 64;
/** 보이는 크기 배율. 좌표는 그대로 두고 SVG만 키운다(입문자가 음표 모양을 알아보게) */
const NOTATION_ZOOM = 1.5;
const READ_ZOOM = 1.8;

/**
 * 알아보기 화면의 멈춰 있는 악보(설계 4-3). 음표를 한 줄로 늘어놓고 지금 칠 음표에 표시를 한다. 친 음표는 흐리게 바꾼다.
 */
export function ReadStaff({ pads, at }: { pads: readonly PadId[]; at: number }) {
  const width = SIDE * 2 + READ_COL * pads.length;
  const height = BOTTOM + 40;
  const box = useRef<HTMLDivElement>(null);
  // 좁은 화면에서 지금 칠 음표가 밖에 있으면 가운데로 스크롤한다
  useEffect(() => {
    const el = box.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const x = (SIDE + READ_COL * at + READ_COL / 2) * READ_ZOOM;
    el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
  }, [at]);
  return (
    <div className="lesson-staff lesson-read-staff" ref={box}>
      <svg width={width * READ_ZOOM} height={height * READ_ZOOM} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`음표 ${pads.length}개 중 ${Math.min(at + 1, pads.length)}번째`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} className="lesson-staff-line" x1={6} x2={width - 6} y1={TOP + GAP * i} y2={TOP + GAP * i} />
        ))}
        {pads.map((pad, i) => {
          const x = SIDE + READ_COL * i + READ_COL / 2;
          const state = i < at ? 'is-done' : i === at ? 'is-now' : 'is-wait';
          return (
            <g key={i} className={`lesson-read-note ${state}`}>
              {i === at && <rect className="lesson-read-cursor" x={x - 24} y={TOP - 38} width={48} height={GAP * 4 + 76} rx={10} />}
              <StaffHead pad={pad} x={x} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
