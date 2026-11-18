// 타격 추적: 왼쪽 최근 타격 목록, 오른쪽에 선택한 타격의 ① 전송 ~ ⑥ 출력 카드. 표시만 하고 계산은 monitor/traceIndex가 한다.
// 선택은 ② HIT 표 행·⑤ 판정 목록 행·이 목록에서 정해지고 사이드바 하단 카드로 고정된다.
import { memo, useEffect, useMemo, useRef } from 'react';
import { hitIdLabel } from '@/features/monitor/core/feed';
import type { JudgeLog } from '@/features/monitor/core/recording/judgeLog';
import type { SwingAssembler } from '@/features/monitor/core/swingAssembler';
import {
  entryMatches,
  indexOfSelection,
  traceList,
  TRACE_STAGE_NAMES,
  TRACE_STAGE_ORDER,
  type TraceCard,
  type TraceSelection,
} from '@/features/monitor/core/recording/traceIndex';
import { SwingScope } from '@/features/monitor/SwingScope';
import { fmt, stickName, type SendFn, type Snap } from '@/features/monitor/monitorTypes';

/** 입력 요소에 포커스가 있으면 ←/→는 그쪽 몫이다 */
function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

const noop = () => {};

export const TraceSection = memo(function TraceSection({
  snap,
  judgeLog,
  selection,
  card,
  onSelect,
  assembler,
  swingVersion,
  send,
  canSend,
}: {
  snap: Snap;
  judgeLog: JudgeLog;
  selection: TraceSelection | null;
  /** 선택의 카드 모델. 선택이 없거나 기록에서 밀렸으면 null */
  card: TraceCard | null;
  onSelect: (sel: TraceSelection) => void;
  assembler: SwingAssembler;
  swingVersion: number;
  send: SendFn;
  canSend: boolean;
}) {
  // 목록은 100ms 스냅샷마다 다시 만든다(judgeLog 링이 제자리에서 바뀌므로 rows 외에 tick도 본다)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => traceList(snap.rows, judgeLog.events()), [snap.tick, snap.rows, judgeLog]);
  const idx = indexOfSelection(list, selection);

  // 이전 = 시간상 더 오래된 타격(목록에서 아래), 다음 = 더 최근. 선택이 목록 밖이면 이동하지 않는다
  const move = (delta: -1 | 1) => {
    if (idx < 0) return;
    const e = list[idx - delta];
    if (e) onSelect(e.sel);
  };
  const moveRef = useRef(move);
  useEffect(() => {
    moveRef.current = move;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      if (e.key === 'ArrowLeft') moveRef.current(-1);
      else if (e.key === 'ArrowRight') moveRef.current(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeRef = useRef<HTMLButtonElement>(null);
  const activeKey = idx < 0 ? null : `${list[idx].t}-${list[idx].hitId}`;
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeKey]);

  return (
    <div className="mon-section">
      <h2 className="mon-section-title">타격 추적</h2>
      <div className="faint small">
        ② HIT 표·⑤ 판정 목록의 행을 누르거나 아래 목록에서 타격을 고르면 ① 전송부터 ⑥ 출력까지 그 타격의 값을 따라가 봅니다. ←/→로 이전·다음 타격으로
        옮깁니다.
      </div>
      <div className="mon-trace">
        <div className="mon-trace-list" role="listbox" aria-label="최근 타격">
          {list.length === 0 && <p className="faint mon-empty">타격이 아직 없습니다.</p>}
          {list.map((e) => {
            const active = entryMatches(e, selection);
            return (
              <button
                key={`${e.t}-${e.hitId}`}
                ref={active ? activeRef : undefined}
                className={`mon-trace-item${active ? ' active' : ''}`}
                role="option"
                aria-selected={active}
                onClick={() => onSelect(e.sel)}
              >
                <span className="num">{fmt(e.t, 0)}</span>
                <strong style={{ color: e.stick === null ? undefined : e.stick === 0 ? 'var(--left)' : 'var(--right)' }}>
                  {stickName(e.stick)}
                </strong>
                <span className="num">{e.seq === null ? `#${e.hitId === null ? '–' : hitIdLabel(e.hitId)}` : `seq ${e.seq}`}</span>
                <span>{e.pad ?? '–'}</span>
                <span className={e.judge === '–' ? 'faint' : undefined}>{e.judge}</span>
              </button>
            );
          })}
        </div>
        <div className="mon-trace-body">
          {!selection ? (
            <p className="faint mon-empty">목록에서 타격을 고르세요.</p>
          ) : !card ? (
            <p className="faint mon-empty">선택한 타격의 기록을 찾지 못했습니다(버퍼에서 밀렸거나 지움).</p>
          ) : (
            <>
              <div className="mon-summary-line">
                <strong>{stickName(card.summary.stick)}</strong> ·{' '}
                {card.summary.seq === null ? `hitId ${card.summary.hitId === null ? '–' : hitIdLabel(card.summary.hitId)}` : `seq ${card.summary.seq}`} · {card.summary.pad ?? '패드 없음'} ·{' '}
                {card.summary.judge} · 수신 {fmt(card.summary.t)}ms
                <span className="mon-trace-nav">
                  <button className="btn-ghost small" disabled={idx < 0 || idx >= list.length - 1} onClick={() => move(-1)}>
                    ← 이전
                  </button>
                  <button className="btn-ghost small" disabled={idx <= 0} onClick={() => move(1)}>
                    다음 →
                  </button>
                </span>
              </div>
              <div className="mon-trace-cards">
                {TRACE_STAGE_ORDER.map((key) => {
                  const st = card.stages[key];
                  return (
                    <div key={key} className={`mon-trace-card ${st.ok ? 'ok' : 'none'}`}>
                      <div className="mon-trace-card-title">{TRACE_STAGE_NAMES[key]}</div>
                      {st.ok ? (
                        <dl className="mon-trace-items">
                          {st.items.map((it) => (
                            <div key={it.label}>
                              <dt>{it.label}</dt>
                              <dd className={it.label === 'hex' ? 'mono' : undefined}>
                                {it.value}
                                {it.unit && <span className="faint"> {it.unit}</span>}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="faint small">{st.reason}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              {card.swingKey && (
                <div className="mon-trace-swing">
                  <div className="faint small">원시 파형(SWING {card.swingKey})</div>
                  <SwingScope
                    assembler={assembler}
                    version={swingVersion}
                    selectedKey={card.swingKey}
                    onSelect={noop}
                    send={send}
                    canSend={canSend}
                    rows={snap.rows}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});
