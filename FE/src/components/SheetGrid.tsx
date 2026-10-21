// 격자 악보 (MODE-sheet-practice 2·3). 마디 2개씩 한 줄, 행 = 패드, 열 = 마디당 16분음.
// DOM 격자라 마디당 요소 수가 작다. 현재 위치(마디·박·재생 헤드)는 현재 줄만 다시 그린다.
import { memo, useEffect, useMemo, useRef } from 'react';
import type { Judgement } from '@/domain/judgement';
import { PAD_META } from '@/domain/pads';
import { positionAt, type SheetBar, type SheetModel, type SheetPosition } from '@/domain/sheet';

const BARS_PER_LINE = 2;
/** 한 화면에 보이는 줄 수 */
const VISIBLE_LINES = 4;

export interface SheetGridProps {
  model: SheetModel;
  /** noteIndex별 판정. 아직 안 쳤으면 null */
  noteStates: (Judgement | null)[];
  /** 채보 밖 타격 (곡 시각 ms) */
  strayHits: { timeMs: number }[];
  /** 곡 시각. 없으면(피드백 모드 등) 현재 위치 표시를 숨긴다 */
  songTimeMs?: number | null;
  /** 이 마디가 보이도록 스크롤 (피드백 카드 클릭) */
  focusBar?: number;
}

interface LineProps {
  model: SheetModel;
  bars: SheetBar[];
  noteStates: (Judgement | null)[];
  strays: { bar: number; step: number }[];
  /** 현재 위치가 이 줄에 있을 때만 값이 있다 */
  pos: SheetPosition | null;
  playing: boolean;
  lineRef: (el: HTMLDivElement | null) => void;
}

const SheetLine = memo(function SheetLine({ model, bars, noteStates, strays, pos, playing, lineRef }: LineProps) {
  const cols = model.stepsPerBar * BARS_PER_LINE;
  const first = bars[0].index;
  const stepsPerBeat = model.stepsPerBar / model.beatsPerBar;
  const colPct = 100 / cols;
  return (
    <div
      className="sheet-line"
      ref={lineRef}
      style={{ ['--beats-per-line' as string]: model.beatsPerBar * BARS_PER_LINE }}
    >
      <div className="sheet-labels">
        <span className="sheet-barno">{first + 1}</span>
        {model.rows.map((pad) => (
          <span key={pad} style={{ color: PAD_META[pad].color }}>
            {PAD_META[pad].short}
          </span>
        ))}
      </div>
      <div className="sheet-body">
        {bars.map((b) => (
          <div
            key={b.index}
            className={`sheet-bar${pos && pos.bar === b.index ? ' current' : ''}`}
            style={{ left: `${((b.index - first) / BARS_PER_LINE) * 100}%`, width: `${100 / BARS_PER_LINE}%` }}
          />
        ))}
        {pos && playing && (
          <div
            className="sheet-beat"
            style={{
              left: `${((pos.bar - first) * model.stepsPerBar + pos.beat * stepsPerBeat) * colPct}%`,
              width: `${stepsPerBeat * colPct}%`,
            }}
          />
        )}
        <div
          className="sheet-notes"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${model.rows.length}, 1fr)`,
          }}
        >
          {bars.flatMap((b) =>
            b.cells.map((c) => {
              const st = noteStates[c.noteIndex];
              return (
                <span
                  key={c.noteIndex}
                  className={`sheet-note${st ? ` ${st.toLowerCase()}` : ''}`}
                  style={{
                    gridColumn: (b.index - first) * model.stepsPerBar + c.step + 1,
                    gridRow: model.rows.indexOf(c.pad) + 1,
                    ['--c' as string]: PAD_META[c.pad].color,
                  }}
                />
              );
            }),
          )}
        </div>
        {strays.map((s, i) => (
          <span
            key={i}
            className="sheet-stray"
            style={{ left: `${((s.bar - first) * model.stepsPerBar + s.step + 0.5) * colPct}%` }}
          />
        ))}
        {pos && playing && (
          <div
            className="sheet-playhead"
            style={{ left: `${(((pos.bar - first) + pos.fraction) / BARS_PER_LINE) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
});

export function SheetGrid({ model, noteStates, strayHits, songTimeMs = null, focusBar }: SheetGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lineEls = useRef<(HTMLDivElement | null)[]>([]);

  const lines = useMemo(() => {
    const out: SheetBar[][] = [];
    for (let i = 0; i < model.bars.length; i += BARS_PER_LINE) out.push(model.bars.slice(i, i + BARS_PER_LINE));
    return out;
  }, [model]);

  // 줄별 채보 밖 타격: 양자화한 칸 위치. 곡 시각이 음수(카운트인)거나 악보 밖이면 버린다
  const straysByLine = useMemo(() => {
    const out: { bar: number; step: number }[][] = lines.map(() => []);
    for (const h of strayHits) {
      if (h.timeMs < 0) continue;
      const p = positionAt(model, h.timeMs);
      const line = Math.floor(p.bar / BARS_PER_LINE);
      if (line < out.length) out[line].push({ bar: p.bar, step: p.step });
    }
    return out;
  }, [lines, strayHits, model]);

  const hasTime = songTimeMs !== null;
  const pos = hasTime ? positionAt(model, songTimeMs) : null;
  // 카운트인 중에는 첫 마디를 현재 마디로 둔다 (재생 헤드·박 띠는 곡이 시작한 뒤부터)
  const activeBar = pos ? Math.max(0, pos.bar) : -1;
  const playing = pos !== null && pos.bar >= 0;
  const activeLine = activeBar >= 0 && activeBar < model.bars.length ? Math.floor(activeBar / BARS_PER_LINE) : -1;

  // 현재 줄이 두 번째 줄이 되도록 스크롤 (첫 줄이면 맨 위)
  const scrollTarget = focusBar !== undefined ? Math.floor(focusBar / BARS_PER_LINE) : activeLine;
  useEffect(() => {
    if (scrollTarget < 0) return;
    const el = lineEls.current[Math.max(0, scrollTarget - 1)];
    const box = scrollRef.current;
    if (el && box) box.scrollTo({ top: el.offsetTop, behavior: 'smooth' });
  }, [scrollTarget, focusBar]);

  return (
    <div
      className="sheet-scroll"
      ref={scrollRef}
      style={{
        ['--sheet-rows' as string]: model.rows.length,
        ['--sheet-lines' as string]: Math.min(VISIBLE_LINES, lines.length),
      }}
    >
      {lines.map((bars, i) => (
        <SheetLine
          key={i}
          model={model}
          bars={bars}
          noteStates={noteStates}
          strays={straysByLine[i]}
          pos={i === activeLine && pos ? { ...pos, bar: activeBar } : null}
          playing={playing}
          lineRef={(el) => {
            lineEls.current[i] = el;
          }}
        />
      ))}
    </div>
  );
}
