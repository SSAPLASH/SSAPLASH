// 곡 편집 창(커버·표시명·삭제) 모달 틀 (설계 CHART-001 4-2). UploadDialog와 같은 규칙: 배경·Esc·포커스·잠금.
// 머리에 제목과 ✕ 닫기. locked(저장·삭제 중)이면 ✕·Esc·배경 클릭을 막는다. 열림은 호출자가 마운트 여부로 정한다.
import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  locked: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function EditDialog({ title, locked, onClose, children }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (el && !el.contains(document.activeElement)) el.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked, onClose]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div className="dialog edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title" tabIndex={-1} ref={dialogRef}>
        <div className="upload-dialog-head">
          <h2 id="edit-dialog-title">{title}</h2>
          <button type="button" className="dialog-close" aria-label="닫기" onClick={onClose} disabled={locked}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
