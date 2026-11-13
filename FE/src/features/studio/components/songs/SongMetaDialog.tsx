// 곡 정보 수정 창 (Figma Studio / SongInfoDialog 204:860, 폭 480; 설계 CHART-001 4-2, v0.3 명칭). 제목(1~100자)·아티스트(0~100자). 바뀐 필드만 onSave로 넘긴다.
import { useState } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Input } from '@/components/ui/form/Input';
import type { SongSummary } from '@/domain/song/songCatalog';
import { META_CHECK_TEXT, MAX_NAME_LEN, diffMeta, validateMeta, type SongMetaPatch } from '@/domain/song/songEdit';
import { EditDialog } from './EditDialog';
import '@/features/studio/components/studio.css';

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
    <EditDialog title="곡 정보 수정" size="info" locked={busy} onClose={onClose}>
      <form
        className="studio-dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) onSave(patch);
        }}
      >
        <Input
          label="곡 제목 *"
          help={`1~${MAX_NAME_LEN}자`}
          type="text"
          value={title}
          maxLength={MAX_NAME_LEN + 20}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Input
          label="아티스트 (선택)"
          help={`${MAX_NAME_LEN}자까지`}
          type="text"
          value={artist}
          maxLength={MAX_NAME_LEN + 20}
          disabled={busy}
          onChange={(e) => setArtist(e.target.value)}
        />
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
