// 리포트의 작은 구역들 (설계 COACH-002 리포트 화면 개편 2장): 관찰 목록 · 패드별 기록 표 · AI 분석 상태 안내.
// 관찰·패드 기록은 둥근 면 하나에 줄과 구분선을 두는 묶음 목록 모양이다(설계 COACH-002-report-apple-redesign ⑥).
// 모두 props만 그린다. 계산은 domain/reportView, 조회·타이머는 페이지가 맡는다.
import type { ReactNode } from 'react';
import type { Judgement } from '@/domain/play/judgement';
import { PAD_META } from '@/domain/kit/pads';
import { isTooShortForAnalysis, type AnalysisStatus, type PadStat, type WeakSegment } from '@/domain/play/report';
import { deltaText, padRows, padStatTotal } from '@/features/result/domain/reportView';
import './report.css';

export interface ObservationRow {
  key: string;
  label: string;
  count: string;
  /** 구간을 여는 버튼. 연주 전체 약점처럼 열 구간이 없으면 없다 */
  action?: { text: string; onClick: () => void; pressed: boolean };
}

/** 관찰 목록(패드 전환 관찰 · 그 밖의 관찰). 줄이 없으면 그리지 않는다 */
export function ObservationList({ id, title, rows }: { id: string; title: string; rows: ObservationRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="rp-observations" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div className="rp-list">
      {rows.map((r) => (
        <div key={r.key} className="rp-observation">
          <div>
            <div className="rp-observation-label">{r.label}</div>
            <div className="rp-observation-count">{r.count}</div>
          </div>
          {r.action && (
            <button type="button" className="rp-observation-button" aria-controls="rp-focus" aria-pressed={r.action.pressed} onClick={r.action.onClick}>
              {r.action.text}
            </button>
          )}
        </div>
      ))}
      </div>
    </section>
  );
}

const DASH = '—';
/** 20.7% · 0% · 100% (소수 한 자리, 끝의 .0은 뺀다) */
const accuracyText = (a: number | null) => (a === null ? DASH : `${Number((a * 100).toFixed(1))}%`);

function PadRow({ s }: { s: PadStat }) {
  return (
    <tr>
      <td>{PAD_META[s.pad].label}</td>
      <td>
        <span className="rp-pad-meter" aria-hidden="true">
          {s.accuracy !== null && <i style={{ width: `${Math.round(Math.min(1, Math.max(0, s.accuracy)) * 100)}%` }} />}
        </span>
        {accuracyText(s.accuracy)}
      </td>
      <td>{padStatTotal(s)}</td>
      <td>{deltaText(s.meanDeltaMs) || DASH}</td>
    </tr>
  );
}

/** 패드별 기록 표. 노트 수 상위 3개만 보이고 나머지는 접는다 */
export function PadTable({ stats, children }: { stats: PadStat[]; children?: ReactNode }) {
  const { main, more } = padRows(stats);
  return (
    <section className="rp-block" aria-labelledby="rp-pad-title">
      <h2 id="rp-pad-title">패드별 기록</h2>
      {main.length === 0 ? (
        <p className="rp-small">패드 통계가 없습니다.</p>
      ) : (
        <table className="rp-pad-table">
          <thead>
            <tr>
              <th scope="col">패드</th>
              <th scope="col">정확도</th>
              <th scope="col">판정 노트</th>
              <th scope="col">평균 타이밍</th>
            </tr>
          </thead>
          <tbody>
            {main.map((s) => (
              <PadRow key={s.pad} s={s} />
            ))}
          </tbody>
        </table>
      )}
      {more.length > 0 && (
        <details className="rp-more">
          <summary>다른 패드 {more.length}개 보기</summary>
          <table className="rp-pad-table" aria-label="다른 패드 기록">
            <tbody>
              {more.map((s) => (
                <PadRow key={s.pad} s={s} />
              ))}
            </tbody>
          </table>
        </details>
      )}
      {children}
    </section>
  );
}

export type PollingState = 'idle' | 'polling' | 'exhausted';

interface NoticeProps {
  status: AnalysisStatus;
  segments: WeakSegment[] | null;
  counts: Record<Judgement, number>;
  polling: PollingState;
  onRefresh: () => void;
}

/** AI 분석 상태 안내 (COACH-003 4-1·4-2의 문구 그대로). 약점이 있으면 그리지 않는다 */
export function AnalysisNotice({ status, segments, counts, polling, onRefresh }: NoticeProps) {
  let body: ReactNode;
  let error = false;
  if (status === 'PENDING') {
    body =
      polling === 'exhausted' ? (
        <>
          <span>아직 분석 중이에요. 잠시 뒤 다시 확인해 주세요</span>
          <button type="button" className="rp-control" onClick={onRefresh}>
            새로고침
          </button>
        </>
      ) : (
        <>
          <span className="weak-spinner" aria-hidden="true" />
          <span>AI가 연주를 분석하고 있어요</span>
        </>
      );
  } else if (status === 'FAILED') {
    error = true;
    body = '이번 연주의 AI 분석을 만들지 못했어요';
  } else if (status === 'NOT_REQUESTED') {
    body = '이 연주는 AI 분석 대상이 아니에요';
  } else if (segments === null) {
    error = true;
    body = '분석 결과가 없어요';
  } else if (segments.length === 0) {
    body = isTooShortForAnalysis(counts) ? '곡이 짧아 분석하지 않았어요' : '뚜렷한 약점이 발견되지 않았어요';
  } else {
    return null;
  }
  return (
    <p className={`rp-notice${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>
      {body}
    </p>
  );
}
