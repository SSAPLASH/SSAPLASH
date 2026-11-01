// 곡 올리기 창(모달) 틀 (Figma Studio / UploadDialog 224:1069, 폭 560). 배경·제목·닫기·Esc·포커스만 맡고 안은 children이다.
// 열림·잠금은 호출자(StudioPage)가 정한다. locked(업로드 중)이면 닫기·Esc·배경 클릭을 무시한다.
import type { ReactNode } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { CloseIcon } from './StudioIcons';
import './studio.css';

interface Props {
  open: boolean;
  locked: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function UploadDialog({ open, locked, onClose, children }: Props) {
  if (!open) return null;

  // 열릴 때 창에 포커스(안쪽에서 이미 가져갔으면 — 다시 올리기 프리필의 [파일 고르기] — 그대로). locked면 Esc·배경 클릭을 막는다
  return (
    <Dialog className="studio-dialog studio-dialog-upload" labelledBy="upload-title" closeOnBackdrop={!locked} closeOnEscape={!locked} onClose={onClose}>
      <div className="studio-dialog-head">
        <h2 id="upload-title">곡 올리기</h2>
        <IconButton size="sm" label="닫기" className="studio-dialog-close" onClick={onClose} disabled={locked}>
          <CloseIcon />
        </IconButton>
      </div>
      {children}
    </Dialog>
  );
}
