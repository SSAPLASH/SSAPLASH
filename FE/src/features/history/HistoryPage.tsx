// 연주 기록 (Figma 연주 기록 112:1351). 머리 + [플레이 기록 | 녹음] 탭 줄 + 탭 본문만 둔다.
// 탭은 URL 쿼리 ?tab=recordings로 정한다(저장 토스트의 [보관함] 링크가 바로 녹음 탭을 연다).
import { useSearchParams } from 'react-router-dom';
import { PlayLogTab } from './PlayLogTab';
import './history.css';
import { RecordingList } from './RecordingList';
import { useShell } from '@/components/shell/nav/useShell';
import { Segmented } from '@/components/ui/form/Segmented';
import { PageHeader } from '@/components/ui/layout/PageHeader';

type HistoryTab = 'logs' | 'recordings';

const TABS: { value: HistoryTab; label: string }[] = [
  { value: 'logs', label: '플레이 기록' },
  { value: 'recordings', label: '녹음' },
];

export function HistoryPage() {
  useShell({ title: '연주 기록' });
  const [params, setParams] = useSearchParams();
  const tab: HistoryTab = params.get('tab') === 'recordings' ? 'recordings' : 'logs';

  const pickTab = (value: HistoryTab) => {
    const next = new URLSearchParams(params);
    if (value === 'recordings') next.set('tab', 'recordings');
    else next.delete('tab');
    setParams(next, { replace: true });
  };

  return (
    <main className="main">
      <div className="history-page">
        <PageHeader title="나의 연주 기록" />

        <div className="history-tabs">
          <Segmented options={TABS} value={tab} onChange={pickTab} label="기록 종류" />
        </div>

        {tab === 'recordings' ? <RecordingList /> : <PlayLogTab />}
      </div>
    </main>
  );
}
