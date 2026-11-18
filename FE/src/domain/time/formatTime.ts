// 곡 시각 표기 도우미

/** ms → m:ss (반올림) */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
