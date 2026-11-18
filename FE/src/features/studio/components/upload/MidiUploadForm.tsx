// 곡 올리기의 MIDI·MusicXML 탭 양식 (설계 CHART-002 2·3-5, 293). 파일 선택·드롭, 제목(파일명 기본값)·아티스트, 사전 검사를 하고
// 업로드 호출은 하지 않는다 — 완성된 MidiDraft를 onSubmit으로 넘긴다. AudioDropzone과 같은 모양·접근성 패턴.
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Input } from '@/components/ui/form/Input';
import { MAX_TITLE_LEN, defaultTitleFromFile } from '@/domain/song/chartJob';
import {
  MAX_MIDI_BYTES,
  MAX_MUSICXML_BYTES,
  MIDI_PRECHECK_TEXT,
  UPLOAD_ACCEPT,
  precheckUpload,
  type MidiDraft,
  type UploadPrecheck,
} from '@/domain/song/midiUpload';
import { UploadIcon } from '@/components/song/StudioIcons';
import '@/features/studio/components/studio.css';

export interface MidiUploadFormProps {
  /** 업로드 진행 중이면 입력을 잠근다 */
  busy: boolean;
  /** 업로드 실패 문구(store의 error). 있으면 버튼 위에 보인다 */
  error: string | null;
  onSubmit: (draft: MidiDraft) => void;
  /** 제목 입력의 처음 값(악보에 곡 올리기: 악보 제목). 마운트 시 한 번만 읽는다 */
  initialTitle?: string;
  /** 있으면 하단에 [취소]를 둔다(업로드 창) */
  onCancel?: () => void;
}

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function MidiUploadForm({ busy, error, onSubmit, initialTitle, onCancel }: MidiUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<UploadPrecheck | null>(null);
  const [title, setTitle] = useState(initialTitle ?? '');
  const [artist, setArtist] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    setFile(f);
    if (!f) {
      setCheck(null);
      return;
    }
    setCheck(precheckUpload(f));
    // 제목이 비어 있을 때만 파일명을 기본값으로 쓴다(직접 친 제목은 유지)
    setTitle((t) => (t.trim() === '' ? defaultTitleFromFile(f.name) : t));
  };

  const onInput = (e: ChangeEvent<HTMLInputElement>) => pick(e.target.files?.[0] ?? null);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    pick(e.dataTransfer.files?.[0] ?? null);
  };

  const trimmedTitle = title.trim();
  const titleOk = trimmedTitle.length > 0 && trimmedTitle.length <= MAX_TITLE_LEN;
  const canSubmit = !busy && file !== null && check?.ok === true && titleOk;

  const submit = () => {
    if (!canSubmit || !file) return;
    onSubmit({ file, title: trimmedTitle, artist: artist.trim() });
  };

  return (
    <div className="studio-form">
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
        <input ref={inputRef} type="file" accept={UPLOAD_ACCEPT} hidden onChange={onInput} disabled={busy} />
        <span className="studio-drop-icon">
          <UploadIcon size={32} />
        </span>
        <span className="studio-drop-title">
          {file ? `${file.name} · ${size(file.size)}` : 'MIDI·MusicXML 파일을 여기에 끌어다 놓으세요'}
        </span>
        <Button
          variant="secondary"
          size="sm"
          className="studio-drop-btn"
          disabled={busy}
          aria-label="MIDI·MusicXML 파일 선택"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          {file ? '다른 파일 고르기' : '파일 고르기'}
        </Button>
        <span className="studio-drop-limits">
          MIDI(.mid · .midi) {size(MAX_MIDI_BYTES)} 이하 · MusicXML 드럼 악보(.musicxml · .xml · .mxl) {size(MAX_MUSICXML_BYTES)} 이하 · 쉬움·보통·어려움
          채보가 바로 만들어져요 · 반주는 없어요 · 악보 이미지·PDF는 받지 않아요
        </span>
      </div>
      {check && !check.ok && (
        <p className="notice error" role="alert">
          {MIDI_PRECHECK_TEXT[check.reason]}
        </p>
      )}

      <div className="studio-fields">
        <Input
          label="곡 제목 *"
          help={`1~${MAX_TITLE_LEN}자`}
          type="text"
          value={title}
          maxLength={MAX_TITLE_LEN}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="파일 이름으로 채워져요"
        />
        <Input
          label="아티스트 (선택)"
          help={`${MAX_TITLE_LEN}자까지`}
          type="text"
          value={artist}
          maxLength={MAX_TITLE_LEN}
          disabled={busy}
          onChange={(e) => setArtist(e.target.value)}
          placeholder="아티스트 이름"
        />
      </div>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}

      <div className="studio-form-footer">
        {onCancel && (
          <Button variant="secondary" size="md" className="studio-footer-btn" onClick={onCancel} disabled={busy}>
            취소
          </Button>
        )}
        <Button variant="primary" size="md" className="studio-footer-btn" onClick={submit} disabled={!canSubmit}>
          {busy ? '업로드 중…' : '채보 만들기'}
        </Button>
      </div>
    </div>
  );
}
