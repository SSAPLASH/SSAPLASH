// 녹음 표시용 순수 함수 (설계 REC-001 6-2). React·스토어·네트워크에 접근하지 않는다.
import type { Difficulty } from '../chart';
import type { RecordingHit, RecordingMode } from '../recording';

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

/** 보관함 길이 m:ss (반올림). components/formatTime의 formatDuration과 같은 규칙(domain은 components를 import하지 않는다) */
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
