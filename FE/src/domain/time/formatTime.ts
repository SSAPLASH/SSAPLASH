// 시각 표기 도우미

/** ms → m:ss (반올림) */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 밀리초 → `m:ss`(1시간 이상은 `h:mm:ss`), 초는 내림. 음수·NaN은 `0:00` */
export function formatClock(ms: number): string {
  const total = Math.floor((Number.isFinite(ms) && ms > 0 ? ms : 0) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 녹음 중 경과 mm:ss (내림, 음수는 0, 분은 두 자리 이상) */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
