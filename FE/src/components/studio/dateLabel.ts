// 내 곡 목록 보기의 날짜 표기 (Figma SongListRow: 방금 · 2시간 전 · 어제 · 10월 26일)
/** 오늘이면 "방금"/"n분 전"/"n시간 전", 어제면 "어제", 올해면 "n월 n일", 그 밖은 "n년 n월 n일" */
export function dateLabel(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) {
    const min = Math.floor(Math.max(0, now - t) / 60_000);
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    return `${Math.floor(min / 60)}시간 전`;
  }
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '어제';
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return d.getFullYear() === today.getFullYear() ? md : `${d.getFullYear()}년 ${md}`;
}
