// 악보 제목 수정 창 (설계 CHART-001 악보 보관 4-5). SongMetaDialog 틀을 따른다: 제목 1~100자, 저장 중 잠금, 창 안 오류 문구.
// 데이터는 모른다. onSubmit이 거부되면 오류 코드를 sheetErrorText로 바꿔 창 안에 보이고, 성공하면 onClose를 부른다.
import { useState } from 'react';
import { EditDialog } from '@/features/studio/components/songs/EditDialog';
import { Button } from '@/components/ui/action/Button';
import { Input } from '@/components/ui/form/Input';
import { SHEET_TITLE_MAX, isValidSheetTitle, sheetErrorCodeOf, sheetErrorText } from '@/features/studio/domain/sheetMusic';
import '@/features/studio/components/studio.css';

interface Props {
  /** 지금 제목 */
  title: string;
  /** 바뀐 제목(앞뒤 공백 제거)으로 저장한다. 실패는 throw */
  onSubmit: (title: string) => Promise<void>;
  onClose: () => void;
}

export function SheetTitleDialog({ title, onSubmit, onClose }: Props) {
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const valid = isValidSheetTitle(value);
  const canSave = !busy && valid && trimmed !== title.trim();

  async function submit() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (e) {
      setError(sheetErrorText(sheetErrorCodeOf(e)));
      setBusy(false);
    }
  }

  return (
    <EditDialog title="제목 수정" size="info" locked={busy} onClose={onClose}>
      <form
        className="studio-dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          label="악보 제목 *"
          help={`1~${SHEET_TITLE_MAX}자`}
          type="text"
          value={value}
          maxLength={SHEET_TITLE_MAX + 20}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
        />
        {!valid && (
          <p className="small" style={{ color: 'var(--miss)' }}>
            {trimmed.length === 0 ? '제목을 입력해 주세요' : `제목은 ${SHEET_TITLE_MAX}자까지예요`}
          </p>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="studio-dialog-footer">
          <Button variant="secondary" size="md" className="studio-footer-btn" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button type="submit" variant="primary" size="md" className="studio-footer-btn" disabled={!canSave}>
            {busy ? '저장 중…' : '저장'}
          </Button>
        </div>
      </form>
    </EditDialog>
  );
}
