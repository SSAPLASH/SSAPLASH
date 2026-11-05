// 곡 삭제 확인 창 (Figma Studio / DeleteDialog 213:919, 폭 420). 삭제해도 연주 기록·결과는 남는다(BE 소프트 삭제, U7).
// 질문 16 + 안내 14, 하단 [취소] secondary md + [삭제] danger md.
import { Button } from '@/components/ui/Button';
import type { SongSummary } from '@/domain/songCatalog';
import { EditDialog } from './EditDialog';
import './studio.css';

interface Props {
  song: SongSummary;
  busy: boolean;
  error: string | null;
  onDelete: () => void;
  onClose: () => void;
}

export function SongDeleteDialog({ song, busy, error, onDelete, onClose }: Props) {
  return (
    <EditDialog title="곡 삭제" size="delete" locked={busy} onClose={onClose}>
      <div className="studio-dialog-body">
        <p className="studio-delete-question">「{song.title}」을 삭제할까요?</p>
        <p className="studio-delete-detail">채보·반주·커버가 함께 지워지고 되돌릴 수 없습니다. 연주 기록과 결과는 남아요.</p>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="studio-dialog-footer">
        <Button variant="secondary" size="md" className="studio-footer-btn" onClick={onClose} disabled={busy}>
          취소
        </Button>
        <Button variant="danger" size="md" className="studio-footer-btn" onClick={onDelete} disabled={busy}>
          {busy ? '삭제 중…' : '삭제'}
        </Button>
      </div>
    </EditDialog>
  );
}
