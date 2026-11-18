// 악보 삭제 확인 창 (설계 CHART-001 악보 보관 4-5). SongDeleteDialog 틀을 따른다: [취소] secondary md + [삭제] danger md.
// 데이터는 모른다. onConfirm이 거부되면 오류 코드를 sheetErrorText로 바꿔 창 안에 보이고, 성공하면 onClose를 부른다.
import { useState } from 'react';
import { EditDialog } from '@/features/studio/components/songs/EditDialog';
import { Button } from '@/components/ui/action/Button';
import { sheetErrorCodeOf, sheetErrorText } from '@/features/studio/domain/sheetMusic';
import '@/features/studio/components/studio.css';

interface Props {
  /** 지울 악보 제목 */
  title: string;
  /** 삭제를 실행한다. 실패는 throw */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function SheetDeleteDialog({ title, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(sheetErrorText(sheetErrorCodeOf(e)));
      setBusy(false);
    }
  }

  return (
    <EditDialog title="악보 삭제" size="delete" locked={busy} onClose={onClose}>
      <div className="studio-dialog-body">
        <p className="studio-delete-question">「{title}」을 삭제할까요?</p>
        <p className="studio-delete-detail">보관한 악보 파일이 지워지고 되돌릴 수 없습니다.</p>
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
        <Button variant="danger" size="md" className="studio-footer-btn" onClick={() => void confirm()} disabled={busy}>
          {busy ? '삭제 중…' : '삭제'}
        </Button>
      </div>
    </EditDialog>
  );
}
