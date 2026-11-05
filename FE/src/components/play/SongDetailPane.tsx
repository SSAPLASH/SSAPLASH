// 선택한 곡 패널 (Figma SongDetailPanel 126:3582, 폭 352). 커버 · 제목 · 아티스트 · BPM·길이 · 최고 점수(sheet 모드는 최고 정확도) · 프리셋 · 연결 상태 · [준비].
// props만 받는다 — 스토어 구독·채보 조회는 호출자(SongPicker)가 한다.
import type { SongSummary } from '@/domain/songCatalog';
import { formatAccuracy } from '@/engine/playLog';
import { Button } from '@/components/ui/Button';
import { SongCover } from '@/components/song/SongCover';
import { SongMeta } from '@/components/song/SongMeta';
import './song-detail.css';

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
  /** 왼손·오른손 스틱 연결 */
  connected: [boolean, boolean];
  /** 키보드 전용(센서 없음)이면 연결 줄 대신 안내를 보인다 */
  keyboardOnly?: boolean;
  /** 채보 정보(기본 채보를 고르는 데 필요) 조회 상태 */
  chartState: 'loading' | 'error' | 'ready';
  onRetry: () => void;
  onPrepare: () => void;
}

function connectionText(connected: [boolean, boolean], keyboardOnly: boolean): string {
  if (keyboardOnly) return '키보드 입력';
  const l = connected[0] ? '연결됨' : '연결 안 됨';
  const r = connected[1] ? '연결됨' : '연결 안 됨';
  return `왼손 ${l} · 오른손 ${r}`;
}

export function SongDetailPane({
  song,
  mode = 'play',
  bestScore,
  bestAccuracy,
  presetName,
  connected,
  keyboardOnly = false,
  chartState,
  onRetry,
  onPrepare,
}: SongDetailPaneProps) {
  if (!song) {
    return (
      <aside className="play-sd" aria-label="선택한 곡">
        <span className="play-sd-caption">선택한 곡</span>
        <p className="play-sd-empty">목록에서 곡을 고르면 여기에 보여요.</p>
      </aside>
    );
  }
  const allOk = keyboardOnly || (connected[0] && connected[1]);
  return (
    <aside className="play-sd" aria-label="선택한 곡">
      <span className="play-sd-caption">선택한 곡</span>
      <SongCover coverUrl={song.coverUrl} className="play-sd-cover" />
      <div className="play-sd-head">
        <h2 className="play-sd-title">{song.title}</h2>
        <p className="play-sd-artist">{song.artist}</p>
      </div>
      <SongMeta bpm={song.bpm} durationSec={song.durationMs === null ? undefined : song.durationMs / 1000} />
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
      <p className="play-sd-line">프리셋: {presetName ?? '없음'}</p>
      <p className={`play-sd-line${allOk ? '' : ' warn'}`}>{connectionText(connected, keyboardOnly)}</p>
      {chartState === 'error' && (
        <p className="play-sd-error" role="alert">
          곡 정보를 불러오지 못했어요.{' '}
          <button type="button" className="play-sd-retry" onClick={onRetry}>
            다시 시도
          </button>
        </p>
      )}
      <Button fullWidth disabled={chartState !== 'ready'} onClick={onPrepare}>
        준비
      </Button>
    </aside>
  );
}
