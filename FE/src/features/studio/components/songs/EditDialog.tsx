// 곡 편집 창(곡 정보·커버·삭제) 모달 틀 (Figma Studio / SongInfoDialog 204:860 · CoverDialog 213:850 · DeleteDialog 213:919). UploadDialog와 같은 규칙: 배경·Esc·포커스·잠금.
// 머리에 제목 20과 닫기 IconButton sm. locked(저장·삭제 중)이면 닫기·Esc·배경 클릭을 막는다. 열림은 호출자가 마운트 여부로 정한다. 폭은 창마다 다르다(곡 정보 480·커버 400·삭제 420).
import type { ReactNode } from 'react';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { IconButton } from '@/components/ui/action/IconButton';
import { CloseIcon } from '@/components/song/StudioIcons';
import '@/features/studio/components/studio.css';

interface Props {
  title: string;
  locked: boolean;
  onClose: () => void;
  /** 창 폭 종류: info 480 · cover 400 · delete 420 */
  size: 'info' | 'cover' | 'delete';
  children: ReactNode;
}

export function EditDialog({ title, locked, onClose, size, children }: Props) {
  // 초기 초점은 창 자체. locked면 Esc·배경 클릭을 막는다
  return (
    <Dialog
      className={`studio-dialog studio-dialog-${size}`}
      labelledBy="edit-dialog-title"
      closeOnBackdrop={!locked}
      closeOnEscape={!locked}
      onClose={onClose}
    >
      <div className="studio-dialog-head">
        <h2 id="edit-dialog-title">{title}</h2>
        <IconButton size="sm" label="닫기" className="studio-dialog-close" onClick={onClose} disabled={locked}>
          <CloseIcon />
        </IconButton>
      </div>
      {children}
    </Dialog>
  );
}
