// 선택한 곡 패널 (Figma SongDetailPanel 126:3582, 폭 352). 커버 · 제목 · 아티스트 · BPM·길이·곡 난이도 · 최고 점수(sheet 모드는 최고 정확도) · [프리셋 · 준비] 한 줄.
// 스틱 연결 문구는 두지 않는다 — 상단 바 스틱 상태로 충분하다(Figma 11/03).
// similar가 있으면 [준비] 줄 아래 구분선과 「✦ 이 곡과 비슷한 곡」 한 줄 + [이 곡 보기](설계 COACH-004-song-picker-ai-tab 3-3, Figma 666:33647).
// `quickStart`가 있으면(악보 연습, 설계 MODE-001-MODE-003-picker-quick-start, Figma 904:4326) 모양이 바뀐다:
// 「선택한 곡」 → 둥근 커버 → 제목 묶음 → 기록 두 칸(최고 정확도 | 프리셋) → 맨 아래 한 줄 [연습 단계 세그먼트][▶ 플레이]. 없으면 위 모양 그대로(/play).
// props만 받는다 — 스토어 구독·채보 조회는 호출자(SongPicker)가 한다.
import type { Difficulty } from '@/domain/chart';
import type { RecommendCard } from '@/domain/recommendation';
import { artistLabel, LEVEL_LABEL, SONG_LEVEL_LABEL, type SongSummary } from '@/domain/songCatalog';
import { formatAccuracy } from '@/engine/playLog';
import { Button } from '@/components/ui/Button';
import { PlayIcon } from '@/components/studio/StudioIcons';
import { Segmented } from '@/components/ui/Segmented';
import { SongCover } from '@/components/song/SongCover';
import { SongMeta } from '@/components/song/SongMeta';
import './song-detail.css';

/** 바로 플레이(악보 연습) 카드 모양. 단계는 쉬움 → 어려움 순 */
export interface QuickStartProps {
  /** 그 곡에 있는 연습 단계(채보). 여기 없는 단계는 세그먼트에서 비활성 */
  charts: { id: number; difficulty: Difficulty }[];
  selectedChartId: number | null;
  onSelectChart: (chartId: number) => void;
  /** 단계(채보) id → 최고 정확도 0~1. 없으면 "—" */
  bestByChart: Record<number, number | undefined>;
  /** ▶ 플레이 */
  onStart: () => void;
}

const DIFFICULTIES: Difficulty[] = ['EASY', 'NORMAL', 'HARD'];

export interface SongDetailPaneProps {
  /** 없으면 안내 문구 */
  song: SongSummary | null;
  /** play(기본)는 최고 점수, sheet는 최고 정확도를 보인다 */
  mode?: 'play' | 'sheet';
  /** 이 곡의 최고 점수(play 모드). 없으면 "—" */
  bestScore?: number;
  /** 이 곡의 최고 정확도 0~1(sheet 모드). 없으면 "—" */
  bestAccuracy?: number;
  presetName: string | null;
  /** 채보 정보(기본 채보를 고르는 데 필요) 조회 상태 */
  chartState: 'loading' | 'error' | 'ready';
  onRetry: () => void;
  onPrepare: () => void;
  /** 선택한 곡과 비슷한 곡(R2) 한 건. 없으면 구분선까지 그리지 않는다 */
  similar?: RecommendCard;
  /** [이 곡 보기] */
  onSimilarPick?: () => void;
  /** 있으면 단계 세그먼트 + [플레이] 모양(악보 연습). 없으면 [준비] */
  quickStart?: QuickStartProps;
}

export function SongDetailPane({
  song,
  mode = 'play',
  bestScore,
  bestAccuracy,
  presetName,
  chartState,
  onRetry,
  onPrepare,
  similar,
  onSimilarPick,
  quickStart,
}: SongDetailPaneProps) {
  if (!song) {
    return (
      <aside className="play-sd" aria-label="선택한 곡">
        <span className="play-sd-caption">선택한 곡</span>
        <p className="play-sd-empty">목록에서 곡을 고르면 여기에 보여요.</p>
      </aside>
    );
  }
  if (quickStart) {
    const q = quickStart;
    const selected = q.charts.find((c) => c.id === q.selectedChartId);
    const best = selected ? q.bestByChart[selected.id] : undefined;
    return (
      <aside className="play-sd play-sd-quick" aria-label="선택한 곡">
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
            <span className="play-sd-record-caption">최고 정확도</span>
            <strong className="play-sd-record-value">{best === undefined ? '—' : formatAccuracy(best)}</strong>
          </div>
          <div className="play-sd-record play-sd-record-end">
            <span className="play-sd-record-caption">프리셋</span>
            <strong className="play-sd-record-value">{presetName ?? '시스템 기본'}</strong>
          </div>
        </div>
        {chartState === 'error' && (
          <p className="play-sd-error" role="alert">
            곡 정보를 불러오지 못했어요.{' '}
            <button type="button" className="play-sd-retry" onClick={onRetry}>
              다시 시도
            </button>
          </p>
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
            className="play-sd-play"
            leadingIcon={<PlayIcon size={16} />}
            disabled={chartState !== 'ready' || selected === undefined}
            onClick={q.onStart}
          >
            플레이
          </Button>
        </div>
        {similar && <SimilarRow similar={similar} onPick={onSimilarPick} />}
      </aside>
    );
  }
  return (
    <aside className="play-sd" aria-label="선택한 곡">
      <span className="play-sd-caption">선택한 곡</span>
      <SongCover coverUrl={song.coverUrl} className="play-sd-cover" />
      <div className="play-sd-head">
        <h2 className="play-sd-title">{song.title}</h2>
        <p className="play-sd-artist">{artistLabel(song.artist)}</p>
      </div>
      <SongMeta
        bpm={song.bpm}
        durationSec={song.durationMs === null ? undefined : song.durationMs / 1000}
        level={song.songLevel === null ? undefined : SONG_LEVEL_LABEL[song.songLevel]}
      />
      <p className="play-sd-best">
        {mode === 'sheet' ? (
          <>
            최고 정확도 <strong>{bestAccuracy === undefined ? '—' : formatAccuracy(bestAccuracy)}</strong>
          </>
        ) : (
          <>
            최고 점수 <strong>{bestScore === undefined ? '—' : bestScore.toLocaleString('ko-KR')}</strong>
          </>
        )}
      </p>
      {chartState === 'error' && (
        <p className="play-sd-error" role="alert">
          곡 정보를 불러오지 못했어요.{' '}
          <button type="button" className="play-sd-retry" onClick={onRetry}>
            다시 시도
          </button>
        </p>
      )}
      <div className="play-sd-ready">
        <p className="play-sd-line">프리셋: {presetName ?? '시스템 기본'}</p>
        <Button className="play-sd-prepare" disabled={chartState !== 'ready'} onClick={onPrepare}>
          준비
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
