// 곡 편집 창(커버·표시명·삭제) 모달 틀 (설계 CHART-001 4-2). UploadDialog와 같은 규칙: 배경·Esc·포커스·잠금.
// locked(저장 중)이면 닫기·Esc·배경 클릭을 무시한다. 열림은 호출자가 마운트 여부로 정한다.
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
        <h2 id="edit-dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
