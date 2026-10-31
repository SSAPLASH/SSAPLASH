// 곡 편집 창(커버·표시명·삭제) 모달 틀 (설계 CHART-001 4-2). UploadDialog와 같은 규칙: 배경·Esc·포커스·잠금.
// 머리에 제목과 ✕ 닫기. locked(저장·삭제 중)이면 ✕·Esc·배경 클릭을 막는다. 열림은 호출자가 마운트 여부로 정한다.
import type { ReactNode } from 'react';
import { Dialog } from '@/components/ui/Dialog';

interface Props {
  title: string;
  locked: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function EditDialog({ title, locked, onClose, children }: Props) {
  // 초기 초점은 창 자체. locked면 Esc·배경 클릭을 막는다
  return (
    <Dialog className="edit-dialog" labelledBy="edit-dialog-title" closeOnBackdrop={!locked} closeOnEscape={!locked} onClose={onClose}>
      <div className="upload-dialog-head">
        <h2 id="edit-dialog-title">{title}</h2>
        <button type="button" className="dialog-close" aria-label="닫기" onClick={onClose} disabled={locked}>
          ✕
        </button>
      </div>
      {children}
    </Dialog>
  );
}
