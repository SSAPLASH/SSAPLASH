// 녹음 저장 창 (설계 REC-001 4-4·6-2, Figma Recording / SaveRecordingDialog 523:31268).
// phase가 pendingSave·saving·failed이고 pending이 있을 때만 그린다. Esc·배경 클릭으로는 닫지 않는다(실수로 녹음을 잃지 않게).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { discard, retry, save, useRecordingStore, type PendingRecording } from '@/runtime/recordingStore';
import { MAX_RECORDING_TITLE_LENGTH } from '@/domain/play/recording';
import { pendingDurationMs, recordingSummaryLine } from '@/domain/play/recordingView';
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { Input } from '@/components/ui/form/Input';
import './recording.css';

const noop = () => {};

export function SaveRecordingDialog() {
  const phase = useRecordingStore((s) => s.phase);
  const pending = useRecordingStore((s) => s.pending);
  const stopReason = useRecordingStore((s) => s.stopReason);
  const error = useRecordingStore((s) => s.error);
  if (!pending || (phase !== 'pendingSave' && phase !== 'saving' && phase !== 'failed')) return null;
  // clientKey가 바뀌면 새 녹음이므로 제목 state를 다시 채우도록 key로 다시 마운트한다
  return (
    <SaveBody
      key={pending.clientKey}
      pending={pending}
      saving={phase === 'saving'}
      failed={phase === 'failed'}
      limit={stopReason === 'limit'}
      error={error}
    />
  );
}

interface BodyProps {
  pending: PendingRecording;
  saving: boolean;
  failed: boolean;
  limit: boolean;
  error: { message: string; retryable: boolean } | null;
}

function SaveBody({ pending, saving, failed, limit, error }: BodyProps) {
  const [title, setTitle] = useState(pending.defaultTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  // 열릴 때 전체 선택해 바로 타이핑하면 덮어쓰게 한다(Dialog의 초기 초점 이후에 실행된다)
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const summary = recordingSummaryLine({
    mode: pending.mode,
    songTitle: pending.songTitle,
    durationMs: pendingDurationMs(pending.baseDurationMs, pending.hits),
    hitCount: pending.hits.length,
  });
  const retryable = failed && Boolean(error?.retryable);
  const finalFailure = failed && !retryable;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (retryable) void retry();
    else if (!failed) void save(title);
  };

  return (
    <Dialog
      as="form"
      onClose={noop}
      closeOnBackdrop={false}
      closeOnEscape={false}
      className="rec-save-dialog"
      labelledBy="rec-save-title"
      initialFocusRef={inputRef}
      onSubmit={onSubmit}
    >
      <div className="rec-save-head">
        <h2 id="rec-save-title">녹음 저장</h2>
      </div>
      <Input
        ref={inputRef}
        label="제목"
        value={title}
        maxLength={MAX_RECORDING_TITLE_LENGTH}
        // 저장 중·실패 뒤에는 잠근다. [다시 시도]는 확정된 본문을 그대로 보내므로 제목을 고쳐도 반영되지 않는다
        disabled={saving || failed}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="rec-save-bottom">
        <div className="rec-save-info">
          {limit && <span className="rec-save-limit">최대 길이에 닿아 녹음을 멈췄어요</span>}
          <span className="rec-save-help">비워 두면 기본 제목으로 저장해요 · 최대 {MAX_RECORDING_TITLE_LENGTH}자</span>
          <span className="rec-save-summary">{summary}</span>
          {failed && error && (
            <span className="rec-save-error" role="alert">
              {error.message}
            </span>
          )}
        </div>
        <div className="rec-save-footer">
          {finalFailure ? (
            <Button variant="secondary" size="md" onClick={discard}>
              닫기
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="md" disabled={saving} onClick={discard}>
                버리기
              </Button>
              <Button variant="primary" size="md" type="submit" disabled={saving}>
                {saving ? '저장 중…' : retryable ? '다시 시도' : '저장'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
