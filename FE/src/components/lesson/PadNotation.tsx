// 레슨 카드의 음표 (설계 SETUP-입문-코스 3-5). 패드마다 오선 위 음표 하나와 이름·치는 손발.
// 위치·머리 모양은 악보 화면과 같은 staffPosOf를 써서 실제 악보와 항상 같다.
import { useEffect, useRef } from 'react';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { staffPosOf } from '@/domain/song/sheet';
import { PAD_LIMB, notationRows } from '@/domain/play/lesson';

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

/** 기둥 길이. StaffHead와 같은 값 */
const STEM = 28;

/** 음표 하나(머리·기둥·덧줄 동그라미)의 위·아래 끝 y. StaffHead와 같은 모양 규칙이다 */
function noteExtent(pad: PadId): { top: number; bottom: number } {
  const { line, head } = staffPosOf(pad);
  const y = yOf(line);
  if (head === 'normal') return line < 4 ? { top: y - 4.4, bottom: y + STEM } : { top: y - STEM, bottom: y + 4.4 };
  return { top: y - STEM, bottom: y + (head === 'circle-cross' ? 7 : 5) };
}

/** 이름 글자 크기(CSS .lesson-staff-name과 같은 값)와 음표 아래 여백 */
const NAME_FONT = 13;
const NAME_GAP = 6;
/** 줄 위·아래 여백 */
const EDGE = 6;

/**
 * 한 줄의 세로 자리. 그 줄 음표가 차지하는 높이만큼만 잡는다(11/13 로컬 확인: 두 줄이 되니 카드가 너무 컸다).
 * 이름 글자는 그 줄에서 가장 아래로 내려온 음표(킥·플로어탐 기둥) 아래에서 시작한다(11/12, 겹쳐 보인다는 로컬 확인 반영)
 */
function rowLayout(pads: readonly PadId[]) {
  const extents = pads.map(noteExtent);
  const top = Math.min(TOP, ...extents.map((e) => e.top)) - EDGE;
  const nameY = Math.max(BOTTOM, ...extents.map((e) => e.bottom)) + NAME_GAP + NAME_FONT;
  const limbY = nameY + 17;
  return { top, nameY, limbY, height: limbY + EDGE - top };
}

export function PadNotation({ pads }: { pads: readonly PadId[] }) {
  const names = pads.map((p) => PAD_META[p].label).join(', ');
  // 읽는 이름은 줄과 상관없이 하나다. 줄마다 그린 오선은 화면 읽기에서 숨긴다
  return (
    <div className="lesson-staff" role="img" aria-label={`악보 위치: ${names}`}>
      {notationRows(pads).map((row, r) => (
        <StaffRow key={r} pads={row} />
      ))}
    </div>
  );
}

/** 오선 한 줄과 그 위 음표·이름·손발 */
function StaffRow({ pads }: { pads: readonly PadId[] }) {
  const width = SIDE * 2 + COL * pads.length;
  const { top, nameY, limbY, height } = rowLayout(pads);
  return (
    <svg width={width * NOTATION_ZOOM} height={height * NOTATION_ZOOM} viewBox={`0 ${top} ${width} ${height}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} className="lesson-staff-line" x1={6} x2={width - 6} y1={TOP + GAP * i} y2={TOP + GAP * i} />
      ))}
      {pads.map((pad, i) => {
        const x = SIDE + COL * i + COL / 2;
        return (
          <g key={pad} data-pad={pad}>
            <StaffHead pad={pad} x={x} />
            <text className="lesson-staff-name" x={x} y={nameY} textAnchor="middle">
              {PAD_META[pad].label}
            </text>
            <text className="lesson-staff-limb" x={x} y={limbY} textAnchor="middle">
              {PAD_LIMB[pad]}
            </text>
          </g>
        );
      })}
    </svg>
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
