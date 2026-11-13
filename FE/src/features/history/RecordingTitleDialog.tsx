// 녹음 제목 변경 창 (Figma 03 Screens / 연주 기록 · 녹음 제목 변경 571:29534, Studio / SheetTitleDialog rename 변형 폭 480. 설계 REC-001 U10 v0.5).
// 제목 20 + 닫기 X, Input + [취소][저장]. 제목 1~100자, 400 RECORDING_INVALID는 입력칸 아래에 detail을 보인다.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { renameRecording } from '@/api/play/recordings';
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { IconButton } from '@/components/ui/action/IconButton';
import { Input } from '@/components/ui/form/Input';
import { MAX_RECORDING_TITLE_LENGTH, type RecordingSummary } from '@/domain/play/recording';
import { classifyMutationError, runWithRetry } from './recordingMutation';
import './recording-list.css';

interface Props {
  item: RecordingSummary;
  onSaved: (summary: RecordingSummary) => void;
  /** 404: 이미 지워진 녹음 */
  onMissing: (id: number) => void;
  onClose: () => void;
}

function CloseGlyph() {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function RecordingTitleDialog({ item, onSaved, onMissing, onClose }: Props) {
  const [title, setTitle] = useState(item.title);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // 열릴 때 전체 선택해 바로 타이핑하면 덮어쓰게 한다(Dialog의 초기 초점 이후에 실행된다)
    inputRef.current?.select();
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const next = title.trim();
    if (next === '') {
      setFieldError('제목을 입력해 주세요');
      return;
    }
    if (next === item.title) {
      onClose();
      return;
    }
    setFieldError(null);
    setFormError(null);
    setBusy(true);
    try {
      const summary = await runWithRetry(() => renameRecording(item.id, next));
      if (!mounted.current) return;
      onSaved(summary);
      onClose();
    } catch (err) {
      if (!mounted.current) return;
      const info = classifyMutationError(err);
      setBusy(false);
      if (info.kind === 'missing') {
        onMissing(item.id);
        onClose();
      } else if (info.kind === 'invalid') {
        setFieldError(info.detail || '제목을 확인해 주세요');
      } else {
        setFormError(info.detail || '제목을 바꾸지 못했어요');
      }
    }
  };

  return (
    <Dialog
      as="form"
      className="rec-list-dialog rec-list-dialog-info"
      labelledBy="rec-title-dialog-title"
      initialFocusRef={inputRef}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="rec-list-dialog-head">
        <h2 id="rec-title-dialog-title">녹음 제목 변경</h2>
        <IconButton size="sm" label="닫기" onClick={onClose} disabled={busy}>
          <CloseGlyph />
        </IconButton>
      </div>
      <div className="rec-list-dialog-form">
        <Input
          ref={inputRef}
          label="제목"
          help={`1~${MAX_RECORDING_TITLE_LENGTH}자`}
          error={fieldError ?? undefined}
          type="text"
          value={title}
          maxLength={MAX_RECORDING_TITLE_LENGTH}
          disabled={busy}
          onChange={(e) => {
            setTitle(e.target.value);
            setFieldError(null);
          }}
        />
        {formError && (
          <div className="notice error" role="alert">
            {formError}
          </div>
        )}
        <div className="rec-list-dialog-footer">
          <Button variant="secondary" size="md" className="rec-list-footer-btn" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button type="submit" variant="primary" size="md" className="rec-list-footer-btn" disabled={busy}>
            {busy ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
