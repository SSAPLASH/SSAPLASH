// 연주 기록 화면 골격. 내용은 묶음 7에서 채운다.
import { useShell } from '@/components/shell/useShell';

export function HistoryPage() {
  useShell({ title: '연주 기록' });
  return (
    <main className="main">
      <h1>연주 기록</h1>
      <p className="dim">곧 채워집니다</p>
    </main>
  );
}
