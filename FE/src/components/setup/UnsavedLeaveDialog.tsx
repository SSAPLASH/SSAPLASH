// 저장하지 않은 변경이 있는 채로 나갈 때의 확인 대화상자. 상태를 갖지 않는다 — 저장 실행·진행·오류는 호출자가 정한다.
import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  message: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

export function UnsavedLeaveDialog({ open, message, busy, error, onCancel, onDiscard, onSave }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // 열릴 때 안전한 쪽("취소")에 포커스
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  // Esc로 취소. 저장 중에는 닫지 않는다
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  // 바깥 클릭은 닫지 않는다 — 실수로 닫히면 오류 문구를 놓친다
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
        <h2 id="unsaved-title">저장하지 않은 변경 사항</h2>
        <p>{message}</p>
        {error && <p className="notice error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn-ghost" ref={cancelRef} onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button type="button" className="btn-ghost" onClick={onDiscard} disabled={busy}>
            저장 안 함
          </button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={busy}>
            {busy ? '저장 중…' : '저장하고 나가기'}
          </button>
        </div>
      </div>
    </div>
  );
}
