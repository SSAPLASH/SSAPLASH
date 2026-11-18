// 자유 연습 반주 화면 상태 계산 (설계 MODE-002 3-4·3-5·3-6). React·오디오·네트워크를 모르는 순수 함수.
import { formatClock } from '@/domain/time/formatTime';
import type { AccompanimentStatus } from './songCatalog';
import type { SongSummary } from './songCatalog';

/** 곡 끝에 붙여 바로 끝나 버리지 않게 두는 여유(ms) */
export const SEEK_END_MARGIN_MS = 250;

/** 10초 뒤로·앞으로 한 번에 옮기는 간격(ms). 라이브러리 재생바와 반주 바가 같이 쓴다 */
export const SKIP_MS = 10_000;

/** 고른 곡. 바에 이름·커버를 그린다 */
export interface AccompanimentPick {
  songId: number;
  title: string;
  artist: string | null;
  coverUrl: string | null;
}

/** 바 변이. 재생기 상태와 1:1이 아니다(3-5) */
export type FreeAccompanimentPhase = 'none' | 'loading' | 'playing' | 'paused' | 'error';

export interface AccompanimentBarView {
  phase: FreeAccompanimentPhase;
  /** none이면 null */
  pick: AccompanimentPick | null;
  positionMs: number;
  durationMs: number;
  /** 예: `1:12 / 3:24` */
  timeText: string;
  /** error일 때만 */
  errorText: string | null;
  /** playing·paused일 때 참 */
  seekable: boolean;
}

/** 선택 창 행 상태 */
export type PickableState = 'ready' | 'generating' | 'hidden';

/** 훅이 바에 넘기는 내부 상태. playerState는 재생기 상태이며 loading은 URL 조회 중 여부다 */
export interface AccompanimentBarInput {
  pick: AccompanimentPick | null;
  playerState: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';
  /** URL 조회·불러오기 진행 중 */
  loading?: boolean;
  /** 재생 중이면 현재 위치, 일시정지면 훅이 든 위치 */
  positionMs: number;
  durationMs: number;
  errorText: string | null;
}

const num = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** 밀리초 → 「1분 12초」(스크린리더용). 1시간 이상은 「1시간 2분 3초」 */
export function formatSpoken(ms: number): string {
  const total = Math.floor(num(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h > 0 ? `${h}시간` : '', h > 0 || m > 0 ? `${m}분` : '', `${s}초`].filter(Boolean).join(' ');
}

/** 요청 위치를 0 이상 (길이 − 250ms) 이하로 자른다. 길이를 모르면(0 이하) 0 */
export function seekTarget(requestMs: number, durationMs: number): number {
  const max = Math.max(0, num(durationMs) - SEEK_END_MARGIN_MS);
  const want = Number.isFinite(requestMs) ? requestMs : 0;
  return Math.min(Math.max(0, want), max);
}

/** 곡 READY + 반주 READY → ready, 반주 GENERATING(곡 READY) → generating, 그 밖 → hidden */
export function pickableForAccompaniment(song: Pick<SongSummary, 'status' | 'accompanimentStatus'>): PickableState {
  const acc: AccompanimentStatus = song.accompanimentStatus;
  if (song.status !== 'READY') return 'hidden';
  if (acc === 'READY') return 'ready';
  if (acc === 'GENERATING') return 'generating';
  return 'hidden';
}

/** 반주를 불러오지 못했을 때의 일반 문구. 바 계산과 오류 변환(components/song/accompanimentError)이 같이 쓴다 */
export const ACCOMPANIMENT_LOAD_FAIL_TEXT = '반주를 불러오지 못했어요';

/** 훅 내부 상태 → 바가 그릴 값(3-5) */
export function accompanimentBarView(input: AccompanimentBarInput): AccompanimentBarView {
  const { pick, playerState, loading, errorText } = input;
  const durationMs = num(input.durationMs);
  const make = (phase: FreeAccompanimentPhase, positionMs: number, err: string | null = null): AccompanimentBarView => ({
    phase,
    pick: phase === 'none' ? null : pick,
    positionMs,
    durationMs,
    timeText: `${formatClock(positionMs)} / ${formatClock(durationMs)}`,
    errorText: err,
    seekable: phase === 'playing' || phase === 'paused',
  });
  if (!pick) return make('none', 0);
  if (errorText !== null || playerState === 'error') return make('error', 0, errorText ?? ACCOMPANIMENT_LOAD_FAIL_TEXT);
  if (loading || playerState === 'loading' || playerState === 'idle') return make('loading', 0);
  if (playerState === 'playing') return make('playing', num(input.positionMs));
  if (playerState === 'paused') return make('paused', num(input.positionMs));
  // ready: 곡이 끝남 → 처음 위치에서 일시정지
  return make('paused', 0);
}
