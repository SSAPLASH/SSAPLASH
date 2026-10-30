// 곡 삭제 확인 창 (설계 CHART-001 4-2, D7). 삭제해도 연주 기록·결과는 남는다(BE 소프트 삭제, U7).
import type { SongSummary } from '@/domain/songCatalog';
import { EditDialog } from './EditDialog';

interface Props {
  song: SongSummary;
  busy: boolean;
  error: string | null;
  onDelete: () => void;
  onClose: () => void;
}

export function SongDeleteDialog({ song, busy, error, onDelete, onClose }: Props) {
  return (
    <EditDialog title="곡 삭제" locked={busy} onClose={onClose}>
      <div className="col" style={{ gap: 12 }}>
        <div className="col" style={{ gap: 6 }}>
          <p className="delete-dialog-question">「{song.title}」을 삭제할까요?</p>
          <p className="delete-dialog-detail small dim">채보·반주·커버가 함께 지워지고 되돌릴 수 없습니다. 연주 기록과 결과는 남아요.</p>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="button" className="btn-danger" onClick={onDelete} disabled={busy}>
            {busy ? '삭제 중…' : '삭제'}
          </button>
        </div>
      </div>
    </EditDialog>
  );
}
