// 곡 작업실의 음원 선택·제목 입력 (설계 CHART-ACCT 2절). 파일을 고르면 사전 검사와 제목 기본값을 채우고,
// 업로드 호출은 하지 않는다 — 완성된 UploadDraft를 onSubmit으로 넘긴다. 파일·제목·아티스트가 바뀌면 멱등 키를 새로 만든다.
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  MAX_AUDIO_BYTES,
  MAX_TITLE_LEN,
  PRECHECK_TEXT,
  defaultTitleFromFile,
  newIdempotencyKey,
  precheckAudio,
  type PrecheckResult,
  type UploadDraft,
} from '@/domain/chartJob';

interface Props {
  /** 업로드 진행 중이면 입력을 잠근다 */
  busy: boolean;
  /** 업로드 실패 문구(store의 error). 있으면 버튼 위에 보인다 */
  error: string | null;
  /** 실패가 같은 내용으로 재시도 가능한 종류면 "다시 시도"를 보인다 */
  retryable: boolean;
  onSubmit: (draft: UploadDraft) => void;
  onRetry: () => void;
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function AudioDropzone({ busy, error, retryable, onSubmit, onRetry }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<PrecheckResult | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [dragging, setDragging] = useState(false);
  // 파일·제목·아티스트 조합마다 키 하나. 바뀌면 null로 두고 제출 때 새로 만든다
  const keyRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    keyRef.current = null;
    setFile(f);
    if (!f) {
      setCheck(null);
      return;
    }
    setCheck(precheckAudio(f));
    setTitle(defaultTitleFromFile(f.name));
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
    keyRef.current ??= newIdempotencyKey();
    onSubmit({ file, title: trimmedTitle, artist: artist.trim(), idempotencyKey: keyRef.current });
  };

  return (
    <div className="studio-form col">
      <div
        className={`studio-drop${dragging ? ' over' : ''}${busy ? ' disabled' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={busy ? -1 : 0}
        onKeyDown={(e) => {
          if (!busy && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label="음원 파일 선택"
      >
        <input ref={inputRef} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav" hidden onChange={onInput} disabled={busy} />
        {file ? (
          <>
            <strong>{file.name}</strong>
            <span className="small dim">{mib(file.size)}</span>
          </>
        ) : (
          <>
            <strong>MP3 · WAV 파일을 여기에 놓거나 클릭해서 고르세요</strong>
            <span className="small dim">최대 {mib(MAX_AUDIO_BYTES)} · 10분 이내 · 드럼이 들어 있는 곡</span>
          </>
        )}
      </div>
      {check && !check.ok && (
        <p className="notice error" role="alert">
          {PRECHECK_TEXT[check.reason]}
        </p>
      )}

      <label className="col" style={{ gap: 4 }}>
        <span className="small dim">곡 제목</span>
        <input
          type="text"
          value={title}
          maxLength={MAX_TITLE_LEN}
          disabled={busy}
          onChange={(e) => {
            keyRef.current = null;
            setTitle(e.target.value);
          }}
          placeholder="제목"
        />
      </label>
      <label className="col" style={{ gap: 4 }}>
        <span className="small dim">아티스트 (선택)</span>
        <input
          type="text"
          value={artist}
          maxLength={MAX_TITLE_LEN}
          disabled={busy}
          onChange={(e) => {
            keyRef.current = null;
            setArtist(e.target.value);
          }}
          placeholder="아티스트"
        />
      </label>

      {error && (
        <div className="notice error row" role="alert" style={{ justifyContent: 'space-between' }}>
          <span>{error}</span>
          {retryable && (
            <button className="btn-ghost small" onClick={onRetry} disabled={busy}>
              다시 시도
            </button>
          )}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn-primary" onClick={submit} disabled={!canSubmit}>
          {busy ? '업로드 중…' : '채보 만들기'}
        </button>
      </div>
      <p className="small faint">
        올린 음원과 분리한 드럼 트랙은 채보를 만든 뒤 지웁니다. 드럼을 뺀 반주는 본인만 들을 수 있게 보관합니다.
      </p>
    </div>
  );
}
