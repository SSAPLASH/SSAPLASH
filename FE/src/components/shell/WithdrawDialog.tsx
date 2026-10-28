// 회원 탈퇴 확인 대화상자. 상태를 갖지 않는다 — 열림·진행·오류는 호출자(MyPage)가 정한다.
import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function WithdrawDialog({ open, busy, error, onCancel, onConfirm }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // 열릴 때 안전한 쪽("취소")에 포커스
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  // Esc로 취소. 요청 중에는 닫지 않는다
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  // 바깥(backdrop) 클릭은 닫지 않는다 — 실수로 닫히면 오류 문구를 놓친다
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="withdraw-title">
        <h2 id="withdraw-title">회원 탈퇴</h2>
        <ul>
          <li>탈퇴하면 되돌릴 수 없습니다.</li>
          <li>올린 곡과 반주는 삭제됩니다.</li>
          <li>학습 활용에 동의한 플레이 기록은 식별 정보를 제거한 뒤 보관됩니다. 동의하지 않은 기록은 삭제됩니다.</li>
          <li>같은 소셜 계정으로 다시 로그인하면 새 회원으로 시작합니다.</li>
        </ul>
        {error && <p className="notice error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn-ghost" ref={cancelRef} onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? '탈퇴 중…' : '탈퇴'}
          </button>
        </div>
      </div>
    </div>
  );
}
