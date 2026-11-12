// 파라미터 패널. ParamStore(상태기)를 구독해 표를 그리고, 불러오기·기본값 복원·개별 적용 버튼만 단다.
import { memo, useState, useSyncExternalStore } from 'react';
import { STICK_FIRMWARE_LABEL } from '@/input/stickProtocol';
import type { ParamStore, ParamRow } from '@/features/monitor/core/params';

const STATE_LABEL = { unknown: '미확인', loading: '불러오는 중…', loaded: '불러옴' } as const;

function noteText(r: ParamRow): React.ReactNode {
  if (r.pending) return <span className="spinner" aria-label="응답 대기" />;
  if (r.note === 'clipped') return <span className="warn">잘림(적용값 {r.current})</span>;
  if (r.note === 'noAck') return <span className="bad">응답 없음</span>;
  if (r.note === 'lost') return <span className="faint">–</span>;
  return null;
}

export const ParamPanel = memo(function ParamPanel({ store, canSend }: { store: ParamStore; canSend: boolean }) {
  useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.version,
  );
  // 입력창 초안. 비어 있으면 적용 중인 값·마지막 입력값을 보여 준다
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const rows = store.rows();

  return (
    <section className="mon-panel">
      <div className="mon-panel-head">
        <h4 className="mon-h">파라미터</h4>
        <span className={`badge ${store.state === 'loaded' ? 'ok' : ''}`}>{STATE_LABEL[store.state]}</span>
        {store.state === 'loaded' && store.lostCount !== null && store.lostCount > 0 && (
          <span className="badge bad">유실 {store.lostCount}개</span>
        )}
        {store.state === 'loaded' && store.lostCount === null && <span className="badge warn">유실 ?</span>}
        <button className="btn-ghost small" disabled={!canSend} onClick={() => store.load()}>
          불러오기
        </button>
        <button className="btn-ghost small" disabled={!canSend} onClick={() => store.resetDefaults()}>
          기본값 복원
        </button>
        <span className="faint" title="기본값 복원에 쓰는 표. 마지막 STATUS의 fwMajor로 정한다">
          기본값 표: {STICK_FIRMWARE_LABEL[store.firmware()]}
          {store.fwMajor === null && ' (STATUS 전)'}
        </span>
      </div>
      <table className="mon-table">
        <thead>
          <tr>
            <th>id</th>
            <th>이름</th>
            <th>단위</th>
            <th>현재값</th>
            <th>입력</th>
            <th></th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const draft = drafts[r.id];
            const shown = draft ?? String(r.input ?? r.current ?? '');
            const parsed = shown.trim() === '' ? null : Number(shown);
            return (
              <tr key={r.id}>
                <td className="mono">0x{r.id.toString(16).padStart(2, '0')}</td>
                <td>{r.meta.label}</td>
                <td className="faint">{r.meta.unit}</td>
                <td className="num">{r.current === null ? '–' : r.current}</td>
                <td>
                  <input
                    type="number"
                    className="mon-input"
                    min={r.meta.min}
                    max={r.meta.max}
                    value={shown}
                    onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                  />
                </td>
                <td>
                  <button
                    className="btn-ghost small"
                    disabled={!canSend || parsed === null || Number.isNaN(parsed) || r.pending}
                    onClick={() => {
                      if (parsed !== null) store.apply(r.id, parsed);
                    }}
                  >
                    적용
                  </button>
                </td>
                <td>{noteText(r)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
});
