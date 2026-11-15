// 플레이 기록 행에 보일 값(설계 COACH-연주-기록-화면-개편 1·4). 서버 기록과 아직 서버에 없는 이 브라우저의 기록을 같은 모양으로 만든다.
// 화면(PlayLogRow)은 이 값만 그리고, 어디서 온 기록인지 따지지 않는다.
import type { PlaySummary } from '@/api/play/plays';
import type { Difficulty } from '@/domain/song/chart';
import { historyRowLevel, historyRowLink, saveStatusOf, type HistoryRowLink, type SaveStatus } from '@/domain/play/playLogView';
import type { PlayLog } from '@/domain/play/playLog';
import { wideGoodMs } from '@/domain/play/judgement';
import { slowRateOf } from '@/domain/song/practiceRate';

/** 제목 옆 칩. ABORTED 끝까지 치지 않음 · DELETED 삭제된 곡(로컬 판정) · UNAVAILABLE 접근할 수 없는 곡(서버 판정) */
export type PlayRowChip = 'ABORTED' | 'DELETED' | 'UNAVAILABLE';

export interface PlayRowView {
  playId: string;
  title: string;
  /** 삭제됐거나 접근할 수 없는 곡이면 제목을 흐리게 */
  titleMuted: boolean;
  mode: string;
  level: Difficulty | null;
  /** 종료 시각(ISO). 날짜 묶음·정렬·보조 줄 시각의 기준(서버 정렬·기간과 같다) */
  at: string;
  /** 연주 길이(ms). 알 수 없으면 null */
  durationMs: number | null;
  /** 정확도 백분율(0~100). 없으면 null */
  accuracy: number | null;
  /** 점수. 악보 연습과 값이 없는 기록은 null */
  score: number | null;
  /** 기본보다 넓혀 연주한 판의 GOOD 폭(ms). 아니면 null */
  wideGoodMs: number | null;
  /** 연습 속도로 친 판의 배율(0~1). 원래 빠르기면 null */
  rate: number | null;
  chips: PlayRowChip[];
  /** 아직 서버에 없는 기록의 저장 상태. 서버 기록과 로그인 없는 빌드는 null */
  save: SaveStatus | null;
  link: HistoryRowLink | null;
}

const NO_TITLE = '제목 없는 연주';

function spanMs(startedAt: string, endedAt: string): number | null {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * 서버 기록. `hasLocal`은 이 브라우저에 같은 연주의 로그가 남아 있는지(리포트가 없을 때 결과 화면으로 간다).
 * `local`은 그 로그. 서버 목록 응답(`PlaySummary`)에는 판정 폭이 없어, 이 브라우저에 로그가 남은 기록만 넓힌 폭을 알 수 있다.
 */
export function serverRowView(play: PlaySummary, hasLocal: boolean, local?: Pick<PlayLog, 'timing'> | null): PlayRowView {
  const unavailable = play.songId != null && !play.songAccessible;
  const chips: PlayRowChip[] = [];
  if (play.endReason != null && play.endReason !== 'COMPLETED') chips.push('ABORTED');
  if (unavailable) chips.push('UNAVAILABLE');
  return {
    playId: play.playId,
    title: play.songTitle ?? NO_TITLE,
    titleMuted: unavailable,
    mode: play.mode,
    level: historyRowLevel({ mode: play.mode, difficulty: play.difficulty ?? '' }),
    at: play.endedAt,
    durationMs: spanMs(play.startedAt, play.endedAt),
    accuracy: play.accuracy,
    score: play.mode === 'SHEET' ? null : play.score,
    wideGoodMs: local ? wideGoodMs(local.timing) : null,
    rate: slowRateOf(play.playbackRate),
    chips,
    save: null,
    link: historyRowLink({ playId: play.playId, hasReport: play.hasReport, hasLocal }),
  };
}

export interface LocalRowOptions {
  /** 삭제(404)로 확인된 곡인지 */
  deleted: boolean;
  /** 지금의 업로드 상태(이번 접속 값이 있으면 그것, 없으면 로그에 저장된 값) */
  upload: PlayLog['upload'];
  /** 저장 상태를 보일지. 로그인 없는 빌드는 서버가 없으므로 보이지 않는다 */
  showSave: boolean;
}

/** 아직 서버에 없는 이 브라우저의 기록. 결과 화면이 이 로그로 열린다 */
export function localRowView(log: PlayLog, o: LocalRowOptions): PlayRowView {
  return {
    playId: log.playId,
    title: log.title,
    titleMuted: o.deleted,
    mode: log.mode,
    level: historyRowLevel(log),
    at: log.endedAt ?? log.startedAt,
    durationMs: Number.isFinite(log.durationMs) ? log.durationMs : null,
    // 부동소수 곱셈 오차(0.852 × 100 = 85.19999…)를 없앤다
    accuracy: Math.round(log.summary.accuracy * 10000) / 100,
    score: log.mode === 'SHEET' ? null : log.summary.score,
    wideGoodMs: wideGoodMs(log.timing),
    rate: slowRateOf(log.playbackRate),
    chips: o.deleted ? ['DELETED'] : [],
    save: o.showSave ? saveStatusOf(o.upload) : null,
    link: historyRowLink({ playId: log.playId, hasReport: false, hasLocal: true }),
  };
}
