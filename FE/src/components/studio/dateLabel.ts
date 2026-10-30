// 내 곡 목록·카드 공용 날짜 표기
/** 오늘이면 "방금"/"n분 전"/"n시간 전", 아니면 날짜 */
export function dateLabel(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  if (d.toDateString() === new Date(now).toDateString()) {
    const min = Math.floor(Math.max(0, now - t) / 60_000);
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    return `${Math.floor(min / 60)}시간 전`;
  }
  return d.toLocaleDateString('ko-KR');
}
