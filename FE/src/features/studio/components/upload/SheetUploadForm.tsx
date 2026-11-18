// 업로드 창의 [악보] 섹션 양식 (설계 CHART-001 악보 보관 2·4-1). 끌어다 놓기·파일 고르기(여러 장), 고른 파일 목록(n/20장, 줄마다 [빼기]),
// 제목(필수 1~100자), 오류 문구 한 곳, [올리기]·[취소]. 파일 검사는 validateSheetFiles, 업로드 호출·BE 오류 문구는 여기서 처리한다.
// 올리는 중에는 입력을 잠그고 onBusyChange로 창(섹션 전환·닫기)도 잠그게 알린다. 성공하면 onUploaded.
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { uploadSheet } from '@/features/studio/api/sheets';
import { Button } from '@/components/ui/action/Button';
import { Input } from '@/components/ui/form/Input';
import { defaultTitleFromFile } from '@/domain/song/chartJob';
import {
  SHEET_MAX_IMAGES,
  SHEET_TITLE_MAX,
  isValidSheetTitle,
  sheetErrorCodeOf,
  sheetErrorText,
  validateSheetFiles,
} from '@/features/studio/domain/sheetMusic';
import { UploadIcon } from '@/components/song/StudioIcons';
import '@/features/studio/components/studio.css';

/** 곡에 붙일 악보로 열었을 때의 대상 곡 */
export interface SheetTargetSong {
  id: number;
  title: string;
}

interface Props {
  /** 있으면 「○○에 붙일 악보」로 열고 제목 기본값을 곡 제목으로 하며 songId를 보낸다. 헤더에서 열면 없다 */
  target?: SheetTargetSong | null;
  /** 업로드 시작·끝. 호출자가 창 닫기·섹션 전환을 잠그는 데 쓴다 */
  onBusyChange: (busy: boolean) => void;
  /** 201 성공 */
  onUploaded: () => void;
  onCancel: () => void;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf';

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function SheetUploadForm({ target = null, onBusyChange, onUploaded, onCancel }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState(target?.title ?? '');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  // BE가 거절한 사유. 파일을 바꾸면 비운다
  const [serverError, setServerError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const check = validateSheetFiles(files);
  const checkError = files.length > 0 && !check.ok && check.reason ? sheetErrorText(check.reason) : null;
  // 오류 문구는 한 곳에만 보인다(D10)
  const errorText = serverError ?? checkError;
  const canSubmit = !busy && check.ok && isValidSheetTitle(title);

  const addFiles = (picked: File[]) => {
    if (busy || picked.length === 0) return;
    setServerError(null);
    setFiles((prev) => [...prev, ...picked]);
    // 곡에 붙이는 경우는 곡 제목을 그대로 두고, 아니면 제목이 비어 있을 때만 첫 파일명을 기본값으로 쓴다
    setTitle((t) => (t.trim() === '' ? defaultTitleFromFile(picked[0].name) : t));
  };

  const removeAt = (index: number) => {
    if (busy) return;
    setServerError(null);
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    // 같은 파일을 빼고 다시 고를 수 있게 값을 비운다
    try {
      e.target.value = '';
    } catch {
      // 값을 비울 수 없는 환경에서는 그대로 둔다
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    onBusyChange(true);
    setServerError(null);
    try {
      await uploadSheet({ files, title: title.trim(), songId: target?.id ?? null });
      if (alive.current) onUploaded();
    } catch (e) {
      if (alive.current) setServerError(sheetErrorText(sheetErrorCodeOf(e)));
    } finally {
      if (alive.current) setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="studio-form">
      {target && <p className="studio-sheet-target">「{target.title}」에 붙일 악보</p>}
      <div
        className={`studio-drop${dragging ? ' over' : ''}${busy ? ' disabled' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          aria-label="악보 파일 선택"
          onChange={onInput}
          disabled={busy}
        />
        <span className="studio-drop-icon">
          <UploadIcon size={32} />
        </span>
        <span className="studio-drop-title">악보 이미지나 PDF를 여기에 끌어다 놓으세요</span>
        <Button
          variant="secondary"
          size="sm"
          className="studio-drop-btn"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          {files.length > 0 ? '파일 더 고르기' : '파일 고르기'}
        </Button>
        <span className="studio-drop-limits">JPG · PNG · WEBP 최대 {SHEET_MAX_IMAGES}장(장당 10MB) 또는 PDF 1개(20MB) · 고른 순서가 쪽 순서예요</span>
      </div>

      {files.length > 0 && (
        <div>
          <div className="studio-sheet-files-head">
            <span>고른 파일</span>
            <span aria-label="고른 장수">
              {files.length}/{SHEET_MAX_IMAGES}
            </span>
          </div>
          <ul className="studio-sheet-files" aria-label="고른 파일 목록">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="studio-sheet-file">
                <span className="studio-sheet-file-name" title={f.name}>
                  {i + 1}. {f.name} · {size(f.size)}
                </span>
                <Button variant="text" size="sm" disabled={busy} aria-label={`${f.name} 빼기`} onClick={() => removeAt(i)}>
                  빼기
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="studio-fields">
        <Input
          label="악보 제목 *"
          help={`1~${SHEET_TITLE_MAX}자`}
          type="text"
          value={title}
          maxLength={SHEET_TITLE_MAX}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="악보 이름을 입력하세요"
        />
      </div>

      {errorText && (
        <div className="notice error" role="alert">
          {errorText}
        </div>
      )}

      <div className="studio-form-footer">
        <Button variant="secondary" size="md" className="studio-footer-btn" onClick={onCancel} disabled={busy}>
          취소
        </Button>
        <Button variant="primary" size="md" className="studio-footer-btn" onClick={() => void submit()} disabled={!canSubmit}>
          {busy ? '올리는 중…' : '올리기'}
        </Button>
      </div>
    </div>
  );
}
