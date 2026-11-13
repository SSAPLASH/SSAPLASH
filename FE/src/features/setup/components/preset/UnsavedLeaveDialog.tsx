// Figma UnsavedLeaveDialog 262:7692(폭 560) — 저장하지 않은 변경이 있는 채로 나갈 때의 확인 대화상자.
// 상태를 갖지 않는다 — 저장 실행·진행·오류는 호출자가 정한다.
import { useRef } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import '@/features/setup/components/setup.css';

interface Props {
  open: boolean;
  message: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
  /** 저장 버튼 이름. 시스템 기본이면 「새 프리셋으로 저장하고 나가기」 */
  saveLabel?: string;
  /** 저장 버튼 잠금(슬롯이 가득 차 새 프리셋을 못 만들 때) */
  saveDisabled?: boolean;
}

export function UnsavedLeaveDialog({ open, message, busy, error, onCancel, onDiscard, onSave, saveLabel = '저장하고 나가기', saveDisabled = false }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  if (!open) return null;

  // 열릴 때 안전한 쪽("취소")에 포커스. Esc로 취소(저장 중에는 닫지 않는다).
  // 바깥 클릭은 닫지 않는다 — 실수로 닫히면 오류 문구를 놓친다
  return (
    <Dialog
      className="setup-leave-dialog"
      labelledBy="unsaved-title"
      initialFocusRef={cancelRef}
      closeOnBackdrop={false}
      closeOnEscape={!busy}
      onClose={onCancel}
    >
      <h2 id="unsaved-title">저장하지 않은 변경 사항</h2>
      <p>{message}</p>
      {error && <p className="notice error">{error}</p>}
      <div className="setup-dialog-actions">
        <Button variant="secondary" ref={cancelRef} onClick={onCancel} disabled={busy}>
          취소
        </Button>
        <Button variant="secondary" onClick={onDiscard} disabled={busy}>
          저장 안 함
        </Button>
        <Button variant="primary" onClick={onSave} disabled={busy || saveDisabled}>
          {busy ? '저장 중…' : saveLabel}
        </Button>
      </div>
    </Dialog>
  );
}
