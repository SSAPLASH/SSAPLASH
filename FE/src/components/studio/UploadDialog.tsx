// 곡 올리기 창(모달) 틀 (설계 CHART-002 2·4-5). 배경·제목·닫기·Esc·포커스만 맡고 안은 children이다.
// 열림·잠금은 호출자(StudioPage)가 정한다. locked(업로드 중)이면 닫기·Esc·배경 클릭을 무시한다.
import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  locked: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function UploadDialog({ open, locked, onClose, children }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // 열릴 때 창에 포커스(탭 순서가 창 안에서 시작한다)
  useEffect(() => {
    const el = dialogRef.current;
    // 안쪽에서 이미 포커스를 가져갔으면(다시 올리기 프리필의 드롭 영역) 건드리지 않는다
    if (open && el && !el.contains(document.activeElement)) el.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, locked, onClose]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        // 배경을 직접 눌렀을 때만 닫는다(창 안 드래그가 밖에서 끝나는 경우는 제외)
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div className="dialog upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title" tabIndex={-1} ref={dialogRef}>
        <div className="upload-dialog-head">
          <h2 id="upload-title">곡 올리기</h2>
          <button type="button" className="btn-ghost small" onClick={onClose} disabled={locked}>
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
