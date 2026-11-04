// AI 약점 구간 목록과 분석 상태 안내 (COACH-003 4-1·4-2). 데이터 요청·타이머는 페이지가 맡는다.
import type { ReactNode } from 'react';
import type { Judgement } from '@/domain/judgement';
import { Chip } from '@/components/ui/Chip';
import { PAD_META } from '@/domain/pads';
import { SegmentPlaybackPanel } from '@/components/report/SegmentPlaybackPanel';
import type { UseSegmentPlayer } from '@/components/report/useSegmentPlayer';
import {
  isTooShortForAnalysis,
  levelBadge,
  segmentBars,
  segmentLevel,
  segmentRangeText,
  type AnalysisStatus,
  type ReportNote,
  type WeakSegment,
} from '@/domain/report';
import { planSegment } from '@/domain/segmentPlayback';

export type PollingState = 'idle' | 'polling' | 'exhausted';

export interface WeakSegmentsProps {
  status: AnalysisStatus;
  segments: WeakSegment[] | null;
  counts: Record<Judgement, number>;
  /** 로그에 bpm·박자가 있으면(게임·악보 모두). 아니면 null */
  bars: { bpm: number; beatsPerBar: number } | null;
  polling: PollingState;
  /** 구간 재생 재료. notes가 null이면(로딩·실패) 재생 버튼을 비활성화한다 */
  playback: { notes: ReportNote[] | null; durationMs: number | null; accompanimentUrl: string | null };
  /** 페이지가 useSegmentPlayer로 만들어 내려준다(컴포넌트는 재생 상태를 들지 않는다) */
  player: UseSegmentPlayer;
  onRefresh: () => void;
}

/** 머리 줄 왼쪽 마디 문구. 연주 전체이거나 마디를 환산할 수 없으면 null */
function formatBars(seg: WeakSegment, bars: WeakSegmentsProps['bars']): string | null {
  if (seg.scope === 'WHOLE' || !bars) return null;
  const b = segmentBars(seg.fromMs, seg.toMs, bars.bpm, bars.beatsPerBar);
  if (!b) return null;
  const [from, to] = [b[0] + 1, b[1] + 1];
  return from === to ? `${from}마디` : `${from}~${to}마디`;
}

function SegmentCard({
  seg,
  cardKey,
  bars,
  playback,
  player,
}: {
  seg: WeakSegment;
  cardKey: string;
  bars: WeakSegmentsProps['bars'];
  playback: WeakSegmentsProps['playback'];
  player: UseSegmentPlayer;
}) {
  const level = segmentLevel(seg);
  const badge = levelBadge(level);
  const barsText = formatBars(seg, bars);
  const whole = seg.scope === 'WHOLE';
  const range = bars && !whole ? segmentBars(seg.fromMs, seg.toMs, bars.bpm, bars.beatsPerBar) : null;
  const total = playback.durationMs && playback.durationMs > 0 ? playback.durationMs : Math.max(seg.toMs, 1);
  const position = whole ? { from: 0, to: 1 } : { from: seg.fromMs / total, to: seg.toMs / total };
  const { notes } = playback;
  const playing = player.playingKey === cardKey;
  return (
    <li className={`weak-card level-${level.toLowerCase()}`}>
      <div className="weak-text">
        <div className="weak-head">
          {(whole || barsText) && <strong className="weak-range">{whole ? '연주 전체' : barsText}</strong>}
          {badge && <span className={`weak-badge tone-${badge.tone}`}>{badge.text}</span>}
          {!whole && seg.pads.length > 0 && (
            <div className="chips">
              {seg.pads.map((p) => (
                <Chip key={p}>{PAD_META[p].label}</Chip>
              ))}
            </div>
          )}
        </div>
        <p className="weak-desc">{seg.description}</p>
        {seg.detail && <p className="weak-detail">{seg.detail}</p>}
        {seg.tip && (
          <p className="weak-tip">
            <span className="weak-tip-label">연습 방법</span>
            {seg.tip}
          </p>
        )}
      </div>
      <SegmentPlaybackPanel
        seg={seg}
        rangeText={segmentRangeText(seg, range, playback.durationMs)}
        position={position}
        playing={playing}
        rate={player.rate}
        loop={player.loop}
        disabled={notes === null}
        onPlay={() => {
          if (notes) player.play(cardKey, planSegment(notes, seg.fromMs, seg.toMs, player.rate), playback.accompanimentUrl);
        }}
        onStop={player.stop}
        onToggleRate={player.toggleRate}
        onToggleLoop={player.toggleLoop}
      />
    </li>
  );
}

function Notice({ error, children }: { error?: boolean; children: ReactNode }) {
  return <div className={error ? 'notice error' : 'notice'}>{children}</div>;
}

function Body({ status, segments, counts, bars, polling, playback, player, onRefresh }: WeakSegmentsProps) {
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
      {ordered.map((s, i) => {
        const key = `${s.scope}:${s.fromMs}:${s.toMs}:${i}`;
        return <SegmentCard key={key} cardKey={key} seg={s} bars={bars} playback={playback} player={player} />;
      })}
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
