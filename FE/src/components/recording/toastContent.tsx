// 녹음 알림 → 토스트 문구·색 (설계 REC-001 3-6). 순수 함수라 SSR 테스트가 직접 쓴다.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { RecordingNotice } from '@/runtime/recordingStore';
import type { ToastVariant } from '@/components/ui/feedback/Toast';

/** 알림 → 토스트 문구·색. SSR 테스트용으로 순수 함수로 둔다 */
export function toastContent(notice: RecordingNotice): { variant: ToastVariant; text: ReactNode } {
  if (notice.kind === 'saved') {
    return {
      variant: 'success',
      text: (
        <>
          녹음을 저장했어요 <Link to="/history?tab=recordings">보관함</Link>
        </>
      ),
    };
  }
  return { variant: 'info', text: '타격이 없어 녹음을 저장하지 않았어요' };
}
