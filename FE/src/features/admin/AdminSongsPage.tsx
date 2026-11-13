// 공용 곡 관리 (관리자 전용, Jira 262, 설계 CHART-001-관리자-공용곡-화면). 라우트는 RequireAdmin 아래.
// 목록·등록·반주는 store/adminSongStore, 이 페이지는 store와 표·추가 창을 접착한다.
import { useEffect, useState } from 'react';
import { AdminBulkDialog } from './AdminBulkDialog';
import { AdminSongAddDialog } from './AdminSongAddDialog';
import { AdminSongTable } from './AdminSongTable';
import { useShell } from '@/components/shell/nav/useShell';
import { Button } from '@/components/ui/action/Button';
import type { AdminSongDraft } from './adminSong';
import { useAdminSongs } from './adminSongStore';
import './admin.css';
import { InlineError } from '@/components/ui/feedback/InlineError';

export function AdminSongsPage() {
  useShell({ title: '공용 곡 관리' });
  const status = useAdminSongs((s) => s.status);
  const songs = useAdminSongs((s) => s.songs);
  const loadError = useAdminSongs((s) => s.loadError);
  const saving = useAdminSongs((s) => s.saving);
  const uploading = useAdminSongs((s) => s.uploading);
  const rowErrors = useAdminSongs((s) => s.rowErrors);
  const load = useAdminSongs((s) => s.load);
  const register = useAdminSongs((s) => s.register);
  const uploadFor = useAdminSongs((s) => s.uploadFor);

  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (draft: AdminSongDraft) => {
    setAddError(null);
    const r = await register(draft);
    if (r.result === 'done' || r.result === 'partial') {
      setAdding(false);
      setNotice(r.result === 'done' ? `「${draft.title.trim()}」을 공용 곡으로 등록했어요.` : r.message);
      return;
    }
    setAddError(r.message);
  };

  const missing = songs.filter((s) => !s.hasAccompaniment).length;

  return (
    <main className="main admin-page">
      <header className="admin-head">
        <div>
          <h2 className="t-title-24">공용 곡 관리</h2>
          <p className="admin-summary">{status === 'ready' ? `공용 곡 ${songs.length}곡 · 반주 없음 ${missing}` : '관리자에게만 보이는 화면이에요.'}</p>
        </div>
        <div className="admin-head-actions">
          <Button variant="secondary" size="md" onClick={() => setBulk(true)} disabled={status !== 'ready'}>
            일괄 추가
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setAddError(null);
              setAdding(true);
            }}
          >
            공용 곡 추가
          </Button>
        </div>
      </header>

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      {status === 'loading' && <p className="admin-summary">불러오는 중…</p>}
      {status === 'error' && (
        <InlineError size="lg" onRetry={() => void load()}>{loadError}</InlineError>
      )}
      {status === 'ready' && <AdminSongTable songs={songs} uploading={uploading} rowErrors={rowErrors} onUpload={(id, file) => void uploadFor(id, file)} />}

      {bulk && <AdminBulkDialog songs={songs} onClose={() => setBulk(false)} onFinished={() => void load()} />}
      {adding && <AdminSongAddDialog busy={saving} error={addError} onSubmit={(d) => void submit(d)} onClose={() => !saving && setAdding(false)} />}
    </main>
  );
}
