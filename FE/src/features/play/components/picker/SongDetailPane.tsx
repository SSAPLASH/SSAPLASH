// 선택한 곡 패널 (Figma Play / SongDetailPanel 바로 플레이 904:4326, 폭 352). 「선택한 곡」 → 둥근 커버 → 제목 묶음 → 기록 두 칸(최고 정확도 또는 최고 점수 | 프리셋) → 맨 아래 한 줄 [연습 단계 세그먼트][▶ 플레이].
// 악보 연습·리듬 게임이 같은 모양을 쓴다(설계 MODE-001-MODE-003-picker-quick-start, MODE-001-play-quick-start). 기록 종류는 `quickStart.bestKind`가 정한다.
// similar가 있으면 맨 아래에 구분선과 「✦ 이 곡과 비슷한 곡」 한 줄 + [이 곡 보기](설계 COACH-004-song-picker-ai-tab 3-3, Figma 666:33647).
// 스틱 연결 문구는 두지 않는다 — 상단 바 스틱 상태로 충분하다(Figma 11/03).
// props만 받는다 — 스토어 구독·채보 조회는 호출자(SongPicker)가 한다.
import { useEffect, useRef } from 'react';
import type { Difficulty } from '@/domain/song/chart';
import type { RecommendCard } from '@/domain/song/recommendation';
import { artistLabel, LEVEL_LABEL, SONG_LEVEL_LABEL, type SongSummary } from '@/domain/song/songCatalog';
import { formatAccuracy } from '@/engine/playLog';
import { Button } from '@/components/ui/action/Button';
import { PlayIcon } from '@/components/song/StudioIcons';
import { Segmented } from '@/components/ui/form/Segmented';
import { SongCover } from '@/components/song/SongCover';
import { SongMeta } from '@/features/play/components/picker/SongMeta';
import './song-detail.css';
import { InlineError } from '@/components/ui/feedback/InlineError';

/** 바로 플레이 카드(악보 연습·리듬 게임). 단계는 쉬움 → 어려움 순 */
export interface QuickStartProps {
  /** 그 곡에 있는 연습 단계(채보). 여기 없는 단계는 세그먼트에서 비활성 */
  charts: { id: number; difficulty: Difficulty }[];
  selectedChartId: number | null;
  onSelectChart: (chartId: number) => void;
  /** 기록 칸의 종류. accuracy(기본)는 「최고 정확도」, score는 「최고 점수」 */
  bestKind?: 'accuracy' | 'score';
  /** 단계(채보) id → 값. accuracy는 0~1, score는 점수. 없으면 "—" */
  bestByChart: Record<number, number | undefined>;
  /** 시작 대기 중이면 ▶ 플레이 자리에 스피너(비활성). 리듬 게임이 채보·반주를 읽는 동안 */
  starting?: boolean;
  /** ▶ 플레이 */
  onStart: () => void;
  /** true면 ▶ 플레이를 누를 수 있게 된 뒤 그 버튼에 포커스를 한 번 주고, 카드 전체가 보이게 스크롤한다(다시 하기·추천으로 곡을 골라 둔 채 들어왔을 때) */
  focusStart?: boolean;
}

const DIFFICULTIES: Difficulty[] = ['EASY', 'NORMAL', 'HARD'];

export interface SongDetailPaneProps {
  /** 없으면 안내 문구 */
  song: SongSummary | null;
  presetName: string | null;
  /** 채보 정보(기본 채보를 고르는 데 필요) 조회 상태 */
  chartState: 'loading' | 'error' | 'ready';
  onRetry: () => void;
  /** 선택한 곡과 비슷한 곡(R2) 한 건. 없으면 구분선까지 그리지 않는다 */
  similar?: RecommendCard;
  /** [이 곡 보기] */
  onSimilarPick?: () => void;
  quickStart: QuickStartProps;
}

export function SongDetailPane({
  song,
  presetName,
  chartState,
  onRetry,
  similar,
  onSimilarPick,
  quickStart,
}: SongDetailPaneProps) {
  const paneRef = useRef<HTMLElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const focused = useRef(false);
  const canStart =
    song !== null && !quickStart.starting && chartState === 'ready' && quickStart.charts.some((c) => c.id === quickStart.selectedChartId);
  const focusStart = quickStart.focusStart === true && canStart;
  // 화면이 바뀌면 셸(AppShell)이 이 효과보다 늦게 제목(h1)에 포커스를 두고 맨 위로 스크롤하므로, 한 프레임 뒤에 넘겨받는다
  useEffect(() => {
    if (!focusStart || focused.current) return;
    const raf = requestAnimationFrame(() => {
      // 글을 치는 중이거나 창이 떠 있으면 두지 않는다
      if (document.activeElement?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (!playRef.current) return;
      focused.current = true;
      playRef.current.focus({ preventScroll: true });
      paneRef.current?.scrollIntoView?.({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusStart]);
  if (!song) {
    return (
      <aside className="play-sd" aria-label="선택한 곡">
        <span className="play-sd-caption">선택한 곡</span>
        <p className="play-sd-empty">목록에서 곡을 고르면 여기에 보여요.</p>
      </aside>
    );
  }
  const q = quickStart;
  const selected = q.charts.find((c) => c.id === q.selectedChartId);
  const best = selected ? q.bestByChart[selected.id] : undefined;
  const isScore = q.bestKind === 'score';
  return (
    <aside ref={paneRef} className="play-sd play-sd-quick" aria-label="선택한 곡">
      <span className="play-sd-caption">선택한 곡</span>
      <SongCover coverUrl={song.coverUrl} className="play-sd-cover" />
      <div className="play-sd-head">
        <h2 className="play-sd-title">{song.title}</h2>
        <p className="play-sd-artist">{artistLabel(song.artist)}</p>
        <SongMeta
          bpm={song.bpm}
          durationSec={song.durationMs === null ? undefined : song.durationMs / 1000}
          level={song.songLevel === null ? undefined : SONG_LEVEL_LABEL[song.songLevel]}
        />
      </div>
      <div className="play-sd-records">
        <div className="play-sd-record">
          <span className="play-sd-record-caption">{isScore ? '최고 점수' : '최고 정확도'}</span>
          <strong className="play-sd-record-value">
            {best === undefined ? '—' : isScore ? Math.round(best).toLocaleString('ko-KR') : formatAccuracy(best)}
          </strong>
        </div>
        <div className="play-sd-record play-sd-record-end">
          <span className="play-sd-record-caption">프리셋</span>
          <strong className="play-sd-record-value">{presetName ?? '시스템 기본'}</strong>
        </div>
      </div>
      {chartState === 'error' && (
        <InlineError plain className="play-sd-error" onRetry={onRetry}>
          곡 정보를 불러오지 못했어요.
        </InlineError>
      )}
      <div className="play-sd-play-row">
        <Segmented
          label="연습 단계"
          className="play-sd-levels"
          value={selected?.difficulty ?? ''}
          options={DIFFICULTIES.map((d) => ({
            value: d,
            label: LEVEL_LABEL[d],
            disabled: !q.charts.some((c) => c.difficulty === d),
          }))}
          onChange={(d) => {
            const c = q.charts.find((x) => x.difficulty === d);
            if (c) q.onSelectChart(c.id);
          }}
        />
        <Button
          ref={playRef}
          className="play-sd-play"
          leadingIcon={<PlayIcon size={20} />}
          disabled={!canStart}
          onClick={q.onStart}
        >
          {q.starting ? <span className="spinner" role="status" aria-label="불러오는 중" /> : '플레이'}
        </Button>
      </div>
      {similar && <SimilarRow similar={similar} onPick={onSimilarPick} />}
    </aside>
  );
}

function SimilarRow({ similar, onPick }: { similar: RecommendCard; onPick?: () => void }) {
  return (
    <>
      <hr className="play-sd-divider" />
      <section className="play-sd-similar" aria-label="이 곡과 비슷한 곡">
        <div className="play-sd-similar-text">
          <span className="play-sd-similar-caption">✦ 이 곡과 비슷한 곡</span>
          <span className="play-sd-similar-title">{similar.song.title}</span>
          <span className="play-sd-similar-meta">
            {[artistLabel(similar.song.artist), similar.song.songLevel === null ? '' : SONG_LEVEL_LABEL[similar.song.songLevel]].filter(Boolean).join(' · ')}
          </span>
          {similar.line && <span className="play-sd-similar-reason">{similar.line}</span>}
        </div>
        <Button variant="secondary" size="sm" className="play-sd-similar-pick" onClick={onPick}>
          이 곡 보기
        </Button>
      </section>
    </>
  );
}
