import type { BestRecordsStatus } from '@/features/play/useBestRecords';
import { InlineError } from '@/components/ui/feedback/InlineError';

export function BestRecordsNotice({ status, retry }: { status: BestRecordsStatus; retry: () => void }) {
  if (status === 'loading') return <p className="dim" role="status">최고 기록을 불러오는 중…</p>;
  if (status !== 'error') return null;
  return (
    <InlineError onRetry={retry}>최고 기록을 불러오지 못했어요.</InlineError>
  );
}
