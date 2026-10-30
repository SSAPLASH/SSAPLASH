// 설정 화면 골격. 내용은 묶음 6에서 채운다.
import { useShell } from '@/components/shell/useShell';

export function SettingsPage() {
  useShell({ title: '설정' });
  return (
    <main className="main">
      <h1>설정</h1>
      <p className="dim">곧 채워집니다</p>
    </main>
  );
}
