// 곡 삭제 확인 창 (Figma Studio / DeleteDialog 213:919, 폭 420). 삭제해도 연주 기록·결과는 남는다(BE 소프트 삭제, U7).
// 재연결 스위치가 꺼져 있으면 BE가 연결된 악보도 같이 지우므로(CHART-001 곡 연결 회신) 악보가 있을 때 안내에 넣는다.
// 켜져 있으면(BE 회신 3, D18) 연결만 끊기고 악보는 남으므로 연결된 곡에는 그렇게 안내한다.
// 질문 16 + 안내 14, 하단 [취소] secondary md + [삭제] danger md.
import { SHEET_RELINK_ENABLED } from '@/config/features';
import { Button } from '@/components/ui/action/Button';
import type { SongSummary } from '@/domain/song/songCatalog';
import { EditDialog } from './EditDialog';
import '@/features/studio/components/studio.css';

interface Props {
  song: SongSummary;
  busy: boolean;
  error: string | null;
  onDelete: () => void;
  onClose: () => void;
}

export function SongDeleteDialog({ song, busy, error, onDelete, onClose }: Props) {
  const withSheet = song.sheetId != null;
  // 켜짐(D18): 악보는 남는다. 꺼짐: 연결된 악보가 곡과 함께 지워진다
  const keepSheet = SHEET_RELINK_ENABLED && withSheet;
  return (
    <EditDialog title="곡 삭제" size="delete" locked={busy} onClose={onClose}>
      <div className="studio-dialog-body">
        <p className="studio-delete-question">「{song.title}」을 삭제할까요?</p>
        <p className="studio-delete-detail">
          {keepSheet
            ? '채보·반주·커버가 함께 지워지고 되돌릴 수 없습니다. 연결된 악보와 연주 기록·결과는 남아요.'
            : `${withSheet ? '채보·반주·커버·악보가' : '채보·반주·커버가'} 함께 지워지고 되돌릴 수 없습니다. 연주 기록과 결과는 남아요.`}
        </p>
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
