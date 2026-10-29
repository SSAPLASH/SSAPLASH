// 커버 변경 창 (설계 CHART-001 4-2). 미리보기 · 이미지 고르기 · 커버 지우기 · 저장. 고른 이미지는 가운데 정사각형 512 JPEG로 만들어 보여 주고,
// 저장을 눌러야 onSave로 넘긴다(여기서는 요청하지 않는다).
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { SongSummary } from '@/domain/songCatalog';
import { COVER_ACCEPT, COVER_PRECHECK_TEXT, precheckCover, type CoverChange } from '@/domain/songCover';
import { makeCoverBlob } from '@/media/coverImage';
import { EditDialog } from './EditDialog';
import { SongCover } from './SongCover';

interface Props {
  song: SongSummary;
  busy: boolean;
  error: string | null;
  onSave: (change: CoverChange) => void;
  onClose: () => void;
}

const READ_FAIL_TEXT = '이미지를 읽지 못했습니다. 다른 이미지를 골라 주세요.';

export function SongCoverDialog({ song, busy, error, onSave, onClose }: Props) {
  const [change, setChange] = useState<CoverChange | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);

  const swapPreview = (url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setPreviewUrl(url);
  };

  // 창이 닫힐 때 미리보기 URL을 해제한다
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!file) return;
    const check = precheckCover(file);
    if (!check.ok) {
      setPickError(COVER_PRECHECK_TEXT[check.reason]);
      return;
    }
    setPickError(null);
    setReading(true);
    try {
      const blob = await makeCoverBlob(file);
      swapPreview(URL.createObjectURL(blob));
      setChange({ kind: 'set', blob });
    } catch {
      setPickError(READ_FAIL_TEXT);
    } finally {
      setReading(false);
    }
  };

  const clear = () => {
    swapPreview(null);
    setPickError(null);
    setChange({ kind: 'clear' });
  };

  // 미리보기: 새로 고른 것 → (지우기면) 기본 커버 → 지금 커버
  const shownUrl = change?.kind === 'set' ? previewUrl : change?.kind === 'clear' ? null : song.coverUrl;
  const canClear = song.coverUrl !== null && change?.kind !== 'clear';
  const canSave = !busy && !reading && change !== null;

  return (
    <EditDialog title="커버 변경" locked={busy} onClose={onClose}>
      <div className="col" style={{ gap: 12 }}>
        <div className="cover-dialog-preview">
          <SongCover key={shownUrl ?? 'default'} title={song.title} coverUrl={shownUrl} />
        </div>
        <input ref={inputRef} type="file" accept={COVER_ACCEPT} hidden onChange={(e) => void onPick(e)} disabled={busy} />
        <div className="row" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn-ghost" onClick={() => inputRef.current?.click()} disabled={busy || reading}>
            {reading ? '이미지 처리 중…' : '이미지 고르기'}
          </button>
          {canClear && (
            <button type="button" className="btn-ghost btn-danger" onClick={clear} disabled={busy || reading}>
              커버 지우기
            </button>
          )}
        </div>
        <p className="small faint" style={{ textAlign: 'center' }}>
          JPG·PNG·WebP, 10 MiB 이하. 가운데를 정사각형으로 잘라 씁니다.
        </p>
        {pickError && (
          <div className="notice error" role="alert">
            {pickError}
          </div>
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
          <button type="button" className="btn-primary" onClick={() => change && onSave(change)} disabled={!canSave}>
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </EditDialog>
  );
}
