// AI 약점 구간 목록과 분석 상태 안내 (COACH-003 4-1·4-2). 데이터 요청·타이머는 페이지가 맡는다.
import type { ReactNode } from 'react';
import type { Judgement } from '@/domain/judgement';
import { PAD_META } from '@/domain/pads';
import { formatSeconds, isTooShortForAnalysis, segmentBars, type AnalysisStatus, type WeakSegment } from '@/domain/report';

/** 이 값 이상이면 강조선·"주의" 뱃지 */
const SEVERE_THRESHOLD = 0.7;

export type PollingState = 'idle' | 'polling' | 'exhausted';

export interface WeakSegmentsProps {
  status: AnalysisStatus;
  segments: WeakSegment[] | null;
  counts: Record<Judgement, number>;
  /** 악보 모드만. 아니면 null */
  bars: { bpm: number; beatsPerBar: number } | null;
  polling: PollingState;
  onRefresh: () => void;
}

/** 시간 범위 문구. SEGMENT는 `7~12초`(초 표기는 AI description과 같은 규칙), 악보 모드면 ` · 3~5마디` 병기. WHOLE은 "연주 전체" */
function formatRange(seg: WeakSegment, bars: WeakSegmentsProps['bars']): string {
  if (seg.scope === 'WHOLE') return '연주 전체';
  const text = `${formatSeconds(seg.fromMs)}~${formatSeconds(seg.toMs)}초`;
  const b = bars ? segmentBars(seg.fromMs, seg.toMs, bars.bpm, bars.beatsPerBar) : null;
  if (!b) return text;
  const [from, to] = [b[0] + 1, b[1] + 1];
  return `${text} · ${from === to ? `${from}마디` : `${from}~${to}마디`}`;
}

function SegmentCard({ seg, bars }: { seg: WeakSegment; bars: WeakSegmentsProps['bars'] }) {
  const severe = seg.severity >= SEVERE_THRESHOLD;
  return (
    <li className={severe ? 'weak-card severe' : 'weak-card'}>
      <div className="row">
        {seg.scope === 'WHOLE' ? <span className="weak-badge">연주 전체</span> : <strong>{formatRange(seg, bars)}</strong>}
        {severe && <span className="weak-badge severe">주의</span>}
      </div>
      <p>{seg.description}</p>
      {seg.pads.length > 0 && (
        <div className="chips">
          {seg.pads.map((p) => (
            <span key={p} className="chip small">
              {PAD_META[p].label}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function Notice({ error, children }: { error?: boolean; children: ReactNode }) {
  return <div className={error ? 'notice error' : 'notice'}>{children}</div>;
}

function Body({ status, segments, counts, bars, polling, onRefresh }: WeakSegmentsProps) {
  if (status === 'PENDING') {
    if (polling === 'exhausted') {
      return (
        <Notice>
          <div className="row">
            <span>아직 분석 중이에요. 잠시 뒤 다시 확인해 주세요</span>
            <button onClick={onRefresh}>새로고침</button>
          </div>
        </Notice>
      );
    }
    return (
      <Notice>
        <span className="weak-spinner" aria-hidden="true" />
        AI가 연주를 분석하고 있어요
      </Notice>
    );
  }
  if (status === 'FAILED') return <Notice error>이번 연주의 AI 분석을 만들지 못했어요</Notice>;
  if (status === 'NOT_REQUESTED') return <Notice>이 연주는 AI 분석 대상이 아니에요</Notice>;
  // DONE
  if (segments === null) return <Notice error>분석 결과가 없어요</Notice>;
  if (segments.length === 0) {
    return <Notice>{isTooShortForAnalysis(counts) ? '곡이 짧아 분석하지 않았어요' : '뚜렷한 약점이 발견되지 않았어요'}</Notice>;
  }
  // 서버 순서를 유지한 채 WHOLE 그룹을 위로
  const ordered = [...segments.filter((s) => s.scope === 'WHOLE'), ...segments.filter((s) => s.scope !== 'WHOLE')];
  return (
    <ul className="weak-list">
      {ordered.map((s, i) => (
        <SegmentCard key={`${s.scope}:${s.fromMs}:${s.toMs}:${i}`} seg={s} bars={bars} />
      ))}
    </ul>
  );
}

export function WeakSegments(props: WeakSegmentsProps) {
  return (
    <div className="card col">
      <h3>AI 약점 분석</h3>
      <Body {...props} />
    </div>
  );
}
