// 표시명 변경 창 (설계 CHART-001 4-2). 제목(1~100자)·아티스트(0~100자). 바뀐 필드만 onSave로 넘긴다.
import { useState } from 'react';
import type { SongSummary } from '@/domain/songCatalog';
import { META_CHECK_TEXT, MAX_NAME_LEN, diffMeta, validateMeta, type SongMetaPatch } from '@/domain/songEdit';
import { EditDialog } from './EditDialog';

interface Props {
  song: SongSummary;
  busy: boolean;
  error: string | null;
  onSave: (patch: SongMetaPatch) => void;
  onClose: () => void;
}

export function SongMetaDialog({ song, busy, error, onSave, onClose }: Props) {
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);

  const check = validateMeta({ title, artist });
  const patch = diffMeta(song, { title, artist });
  const changed = Object.keys(patch).length > 0;
  const canSave = !busy && check.ok && changed;

  return (
    <EditDialog title="표시명 변경" locked={busy} onClose={onClose}>
      <form
        className="col"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) onSave(patch);
        }}
      >
        <label className="col" style={{ gap: 4 }}>
          <span className="small dim">곡 제목</span>
          <input type="text" value={title} maxLength={MAX_NAME_LEN + 20} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="small dim">아티스트 (선택)</span>
          <input type="text" value={artist} maxLength={MAX_NAME_LEN + 20} disabled={busy} onChange={(e) => setArtist(e.target.value)} />
        </label>
        {!check.ok && (
          <p className="small" style={{ color: 'var(--miss)' }}>
            {META_CHECK_TEXT[check.reason]}
          </p>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="submit" className="btn-primary" disabled={!canSave}>
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </form>
    </EditDialog>
  );
}
