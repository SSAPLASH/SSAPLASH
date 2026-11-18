// 녹음 삭제 확인 창 (Figma 03 Screens / 연주 기록 · 녹음 삭제 571:29597, Studio / DeleteDialog 폭 420. 설계 REC-001 U10 v0.5).
// 본문 첫 줄은 녹음 제목(16 Medium, 말줄임), 둘째 줄은 안내(14 text-2). 하단 [취소] secondary + [삭제] danger가 폭을 반씩 채운다.
import { useEffect, useRef, useState } from 'react';
import { deleteRecording } from '@/api/play/recordings';
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { IconButton } from '@/components/ui/action/IconButton';
import type { RecordingSummary } from '@/domain/play/recording';
import { classifyMutationError, runWithRetry } from './recordingMutation';
import './recording-list.css';

interface Props {
  item: RecordingSummary;
  onDeleted: (id: number) => void;
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

export function RecordingDeleteDialog({ item, onDeleted, onMissing, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const remove = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await runWithRetry(() => deleteRecording(item.id));
      if (!mounted.current) return;
      onDeleted(item.id);
      onClose();
    } catch (err) {
      if (!mounted.current) return;
      const info = classifyMutationError(err);
      setBusy(false);
      if (info.kind === 'missing') {
        onMissing(item.id);
        onClose();
      } else {
        setError(info.detail || '삭제하지 못했어요');
      }
    }
  };

  return (
    <Dialog
      className="rec-list-dialog rec-list-dialog-delete"
      labelledBy="rec-delete-dialog-title"
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      onClose={onClose}
    >
      <div className="rec-list-dialog-head">
        <h2 id="rec-delete-dialog-title">녹음 삭제</h2>
        <IconButton size="sm" label="닫기" onClick={onClose} disabled={busy}>
          <CloseGlyph />
        </IconButton>
      </div>
      <div className="rec-list-dialog-body">
        <p className="rec-list-delete-question">{item.title}</p>
        <p className="rec-list-delete-detail">이 녹음을 삭제할까요? 녹음 파일이 지워지고 되돌릴 수 없어요.</p>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="rec-list-dialog-footer">
        <Button variant="secondary" size="md" className="rec-list-footer-btn" onClick={onClose} disabled={busy}>
          취소
        </Button>
        <Button variant="danger" size="md" className="rec-list-footer-btn" onClick={remove} disabled={busy}>
          {busy ? '삭제 중…' : '삭제'}
        </Button>
      </div>
    </Dialog>
  );
}
