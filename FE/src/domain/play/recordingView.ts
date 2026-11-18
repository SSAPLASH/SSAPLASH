// 녹음 표시용 순수 함수 (설계 REC-001 6-2). React·스토어·네트워크에 접근하지 않는다.
import type { Difficulty } from '@/domain/song/chart';
import { FREE_RECORDING_NAME, recordingTitleSuffix, type RecordingHit, type RecordingMode, type RecordingSummary } from './recording';

/** 보관함 최대 녹음 개수(도구 줄 문구용) */
export const RECORDING_QUOTA = 200;

/** 모드 표시 이름. 알 수 없는 모드(TEMPO 등)는 값 그대로 */
export function recordingModeName(mode: RecordingMode): string {
  switch (mode) {
    case 'FREE':
      return '자유 연습';
    case 'RHYTHM':
      return '리듬 게임';
    case 'SHEET':
      return '악보 연습';
    default:
      return mode;
  }
}

/** 타격 수 표기: 1904 → "1,904타" */
export function formatHitCount(n: number): string {
  return `${n.toLocaleString('ko-KR')}타`;
}

/** 녹음 중 경과 mm:ss (내림, 음수는 0, 분은 두 자리 이상) */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 보관함 길이 m:ss (반올림). domain/time/formatTime의 formatDuration과 같은 규칙 */
export function formatRecordingLength(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 저장 창 요약: `{모드명} · {곡 제목} · {m:ss} · 타격 {n}개`. 곡 제목이 null이면 그 칸을 뺀다 */
export function recordingSummaryLine(args: {
  mode: RecordingMode;
  songTitle: string | null;
  durationMs: number;
  hitCount: number;
}): string {
  const parts = [recordingModeName(args.mode)];
  if (args.songTitle !== null) parts.push(args.songTitle);
  parts.push(formatRecordingLength(args.durationMs));
  parts.push(`타격 ${args.hitCount.toLocaleString('ko-KR')}개`);
  return parts.join(' · ');
}

/** 저장 본문 길이: max(기본 길이, 마지막 tMs)를 정수로 올림. hits가 비면 기본 길이 */
export function pendingDurationMs(baseDurationMs: number, hits: readonly RecordingHit[]): number {
  if (hits.length === 0) return baseDurationMs;
  return Math.ceil(Math.max(baseDurationMs, hits[hits.length - 1].tMs));
}

/** 곡 난이도 문자열 → Difficulty. EASY·NORMAL·HARD가 아니면 null(LevelBadge 생략용) */
export function songDifficulty(d: string | null | undefined): Difficulty | null {
  return d === 'EASY' || d === 'NORMAL' || d === 'HARD' ? d : null;
}

/** 도구 줄 개수 문구 */
export function recordingCountLabel(total: number): string {
  return `녹음 ${total}개 · 최대 ${RECORDING_QUOTA}개`;
}

/** 녹음 행에 보일 제목과, 보조 정보에서 겹쳐서 뺄 것 */
export interface RecordingRowLabel {
  title: string;
  /** 제목이 곧 곡 제목이다 — 보조 정보에 곡을 다시 적지 않고 난이도 배지를 제목 옆에 둔다 */
  songInTitle: boolean;
  /** false면 제목이 곧 모드 이름("자유 연습")이라 보조 정보에 모드를 다시 적지 않는다 */
  showMode: boolean;
}

/**
 * 녹음 행 제목. 저장할 때 붙는 기본 제목(`{곡 제목} · {M월 D일 HH:mm}`)을 그대로 둔 녹음은 곡 제목·녹음 시각이 보조 정보와 겹치므로
 * 시각을 떼고 이름만 보인다. 직접 지은 제목은 그대로 둔다. 저장된 제목은 바꾸지 않는다(표시만).
 */
export function recordingRowLabel(item: Pick<RecordingSummary, 'title' | 'mode' | 'startedAt' | 'song'>): RecordingRowLabel {
  const plain: RecordingRowLabel = { title: item.title, songInTitle: false, showMode: true };
  const at = new Date(item.startedAt);
  if (Number.isNaN(at.getTime())) return plain;
  const suffix = recordingTitleSuffix(at);
  if (!item.title.endsWith(suffix)) return plain;
  const name = item.title.slice(0, -suffix.length);
  if (name.trim() === '') return plain;

  const songTitle = item.song?.title.trim() ?? '';
  // 100자를 넘겨 "…"으로 줄여 붙인 곡 제목도 같은 곡으로 본다
  const cut = name.endsWith('…') ? name.slice(0, -1) : null;
  if (songTitle !== '' && (name === songTitle || (cut !== null && cut !== '' && songTitle.startsWith(cut)))) {
    return { title: songTitle, songInTitle: true, showMode: true };
  }
  if (item.song === null && item.mode === 'FREE' && name === FREE_RECORDING_NAME) {
    return { title: name, songInTitle: false, showMode: false };
  }
  return { title: name, songInTitle: false, showMode: true };
}
