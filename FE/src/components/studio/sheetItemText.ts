// 악보 항목 문구 (설계 CHART-001 악보 보관 4-2). 카드·목록 줄이 같이 쓴다.
import type { SheetSummary } from '@/domain/sheetMusic';

/** 부제 자리 문구: 「악보 · 이미지 n쪽」 또는 「악보 · PDF」 */
export function sheetSubtitle(sheet: SheetSummary): string {
  return sheet.kind === 'PDF' ? '악보 · PDF' : `악보 · 이미지 ${sheet.pageCount}쪽`;
}

/** 음원이 필요한 버튼을 비활성으로 둘 때 붙이는 설명 */
export const SHEET_NO_AUDIO_HINT = '음원이 있어야 할 수 있어요';
