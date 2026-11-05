import type { BestRecordsStatus } from '@/app/useBestRecords';
import { Button } from '@/components/ui/Button';

export function BestRecordsNotice({ status, retry }: { status: BestRecordsStatus; retry: () => void }) {
  if (status === 'loading') return <p className="dim" role="status">최고 기록을 불러오는 중…</p>;
  if (status !== 'error') return null;
  return (
    <div className="notice error row" role="alert">
      <span>최고 기록을 불러오지 못했어요.</span>
      <Button variant="text" size="sm" onClick={retry}>다시 시도</Button>
    </div>
  );
}
