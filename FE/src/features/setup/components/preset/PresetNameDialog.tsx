// Figma PresetNameDialog 228:1197(폭 400) — 새 프리셋 이름 입력 대화상자.
// 입력마다 validatePresetName으로 검증하고, 저장 실행은 호출자(onSave)가 한다.
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { Input } from '@/components/ui/form/Input';
import { PRESET_NAME_MAX, normalizePresetName, validatePresetName, type KitPreset } from '@/domain/kit/preset';
import { PRESET_NAME_ERROR_TEXT } from '@/domain/kit/calibration/setupSteps';
import '@/features/setup/components/setup.css';

interface Props {
  open: boolean;
  /** 중복 검사 대상(현재 프리셋 목록) */
  existing: KitPreset[];
  busy: boolean;
  /** 서버 저장 오류 문구 */
  error: string | null;
  /** 정리(trim)된 이름을 넘긴다 */
  onSave: (name: string) => void;
  onCancel: () => void;
  /** 입력 칸 처음 값(기본 빈 값). 검증 표시를 렌더 테스트하려고 열어 둔다 */
  initialValue?: string;
}

export function PresetNameDialog(props: Props) {
  // 열릴 때마다 입력값을 비우도록 열린 동안에만 본문을 마운트한다
  return props.open ? <PresetNameDialogBody {...props} /> : null;
}

function PresetNameDialogBody({ existing, busy, error, onSave, onCancel, initialValue = '' }: Props) {
  const [raw, setRaw] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const code = validatePresetName(raw, existing);
  const valid = code === null;
  const message = code === 'TOO_LONG' || code === 'DUPLICATE' ? PRESET_NAME_ERROR_TEXT[code] : null;

  // 열릴 때 입력 칸에 초점. Esc로 취소(저장 중에는 닫지 않는다). 배경 클릭은 기존처럼 닫지 않는다
  return (
    <Dialog
      as="form"
      className="setup-name-dialog"
      labelledBy="preset-name-title"
      initialFocusRef={inputRef}
      closeOnBackdrop={false}
      closeOnEscape={!busy}
      onClose={onCancel}
      onSubmit={(e) => {
        e.preventDefault(); // Enter = 유효할 때만 저장
        if (valid && !busy) onSave(normalizePresetName(raw));
      }}
    >
      <h2 id="preset-name-title">새 프리셋</h2>
      <Input
        ref={inputRef}
        label="프리셋 이름"
        type="text"
        value={raw}
        disabled={busy}
        placeholder="예: 연습용 배치"
        help={`1~${PRESET_NAME_MAX}자`}
        error={message ?? undefined}
        counter={{ value: Array.from(raw).length, max: PRESET_NAME_MAX }}
        onChange={(e) => setRaw(e.target.value)}
      />
      {error && <p className="notice error">{error}</p>}
      <div className="setup-dialog-actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          취소
        </Button>
        <Button type="submit" variant="primary" disabled={!valid || busy}>
          {busy ? '저장 중…' : '저장'}
        </Button>
      </div>
    </Dialog>
  );
}
