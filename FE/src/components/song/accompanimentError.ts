// 반주 불러오기 오류를 바 문구로 바꾼다. ApiError를 알아야 해서 domain이 아니라 곡 공유 부품에 둔다.
import { ApiError } from '@/api/error';
import { ACCOMPANIMENT_LOAD_FAIL_TEXT } from '@/domain/song/freeAccompaniment';

/** URL이 null이거나 반주 객체가 없을 때의 문구 */
export const ACCOMPANIMENT_NO_FILE_TEXT = '이 곡은 반주 파일이 없어요';

/** 반주 불러오기 오류 → 바 문구(3-6). ApiError가 아니면(네트워크·디코드) 일반 실패 문구 */
export function accompanimentErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404 && error.code === 'CHART_ASSET_NOT_FOUND') return ACCOMPANIMENT_NO_FILE_TEXT;
    if (error.status === 404 && error.code === 'SONG_NOT_FOUND') return '곡을 찾을 수 없어요. 삭제됐을 수 있어요';
    if (error.status === 409) return '곡이 아직 준비 중이에요';
  }
  return ACCOMPANIMENT_LOAD_FAIL_TEXT;
}
