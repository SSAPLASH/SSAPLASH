// 원시 탭: 최근 300건 hex 스트림(타입·방향 필터) + LOG 콘솔.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { CommandType } from '@/input/stickProtocol';
import type { LogRow } from '@/features/monitor/core/recording/packetLog';
import { hexSpaced } from './hitFields';
import { fmt, type Snap } from './monitorTypes';

const MAX_ROWS = 300;
const LOG_ROWS = 100;

/** 필터 키 → 표시 이름. decoded.kind('out'은 송신)와 대응 */
const KINDS: { key: string; label: string; defaultOn: boolean }[] = [
  { key: 'hit', label: 'HIT', defaultOn: true },
  // POSE는 초당 100건 넘게 와서 300건이 3초면 사라지므로 기본은 끈다
  { key: 'pose', label: 'POSE', defaultOn: false },
  { key: 'status', label: 'STATUS', defaultOn: true },
  { key: 'syncAck', label: 'SYNC', defaultOn: true },
  { key: 'paramAck', label: 'PARAM', defaultOn: true },
  { key: 'log', label: 'LOG', defaultOn: true },
  { key: 'swing', label: 'SWING', defaultOn: true },
  { key: 'bridgeStats', label: 'BRIDGE', defaultOn: true },
  { key: 'error', label: 'ERROR', defaultOn: true },
  { key: 'out', label: 'OUT', defaultOn: true },
];

const KIND_NAME: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.label]));
const CMD_NAME: Record<number, string> = Object.fromEntries(Object.entries(CommandType).map(([k, v]) => [v, k]));

type DirFilter = 'all' | 'in' | 'out';

const kindOf = (r: LogRow): string => (r.dir === 'out' ? 'out' : (r.decoded?.kind ?? 'error'));

const typeName = (r: LogRow): string => {
  if (r.dir === 'out') return r.outType === null ? 'CMD ?' : (CMD_NAME[r.outType] ?? `0x${r.outType.toString(16)}`);
  return KIND_NAME[kindOf(r)] ?? kindOf(r);
};

const RawRow = memo(function RawRow({ row }: { row: LogRow }) {
  const isErr = row.decoded?.kind === 'error';
  return (
    <tr className={isErr ? 'mon-row-error' : row.dir === 'out' ? 'mon-row-out' : ''}>
      <td className="num">{fmt(row.t)}</td>
      <td>{row.dir === 'out' ? '→' : '←'}</td>
      <td>{row.transport}</td>
      <td>{row.stick === null ? '' : row.stick === 0 ? 'L' : 'R'}</td>
      <td>{typeName(row)}</td>
      <td className="num">{row.bytes.length}</td>
      <td className="mono">{hexSpaced(row.bytes)}</td>
    </tr>
  );
});

export const HexStream = memo(function HexStream({ snap }: { snap: Snap }) {
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(KINDS.map((k) => [k.key, k.defaultOn])));
  const [dir, setDir] = useState<DirFilter>('all');

  const view = useMemo(() => {
    const out: LogRow[] = [];
    for (let i = snap.rows.length - 1; i >= 0 && out.length < MAX_ROWS; i--) {
      const r = snap.rows[i];
      if (dir !== 'all' && r.dir !== dir) continue;
      if (!on[kindOf(r)]) continue;
      out.push(r);
    }
    return out; // 최신 먼저
  }, [snap.rows, on, dir]);

  const logs = useMemo(() => {
    const out: LogRow[] = [];
    for (let i = snap.rows.length - 1; i >= 0 && out.length < LOG_ROWS; i--) {
      if (snap.rows[i].decoded?.kind === 'log') out.push(snap.rows[i]);
    }
    return out.reverse();
  }, [snap.rows]);

  // LOG 콘솔은 항상 맨 아래로 고정
  const consoleRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="mon-raw">
      <div className="mon-filters">
        {KINDS.map((k) => (
          <label key={k.key} className="chip-check">
            <input type="checkbox" checked={on[k.key]} onChange={(e) => setOn((o) => ({ ...o, [k.key]: e.target.checked }))} />
            {k.label}
          </label>
        ))}
        <select value={dir} onChange={(e) => setDir(e.target.value as DirFilter)}>
          <option value="all">방향 전체</option>
          <option value="in">수신(←)만</option>
          <option value="out">송신(→)만</option>
        </select>
        <span className="faint small">최근 {MAX_ROWS}건 · 최신이 위</span>
      </div>
      <div className="mon-table-wrap">
        <table className="mon-table">
          <thead>
            <tr>
              <th>t(ms)</th>
              <th>방향</th>
              <th>전송</th>
              <th>손</th>
              <th>타입</th>
              <th>길이</th>
              <th>hex</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <RawRow key={r.id} row={r} />
            ))}
          </tbody>
        </table>
      </div>
      <h4 className="mon-h">LOG 콘솔</h4>
      <pre ref={consoleRef} className="mon-console">
        {logs.length === 0
          ? '(LOG 없음)'
          : logs.map((r) => `[${fmt(r.t)}] ${r.decoded?.kind === 'log' ? r.decoded.text : ''}`).join('\n')}
      </pre>
    </div>
  );
});
