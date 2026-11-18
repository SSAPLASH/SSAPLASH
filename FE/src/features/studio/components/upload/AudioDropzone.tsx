// 곡 작업실의 음원 선택·제목 입력 (설계 CHART-ACCT 2절). 파일을 고르면 사전 검사와 제목 기본값을 채우고,
// 업로드 호출은 하지 않는다 — 완성된 UploadDraft를 onSubmit으로 넘긴다. 파일·제목·아티스트가 바뀌면 멱등 키를 새로 만든다.
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Input } from '@/components/ui/form/Input';
import {
  MAX_AUDIO_BYTES,
  MAX_TITLE_LEN,
  PRECHECK_TEXT,
  defaultTitleFromFile,
  newIdempotencyKey,
  precheckAudio,
  type PrecheckResult,
  type UploadDraft,
} from '@/domain/song/chartJob';
import { UploadIcon } from '@/components/song/StudioIcons';
import '@/features/studio/components/studio.css';

interface Props {
  /** 업로드 진행 중이면 입력을 잠근다 */
  busy: boolean;
  /** 업로드 실패 문구(store의 error). 있으면 버튼 위에 보인다 */
  error: string | null;
  /** 실패가 같은 내용으로 재시도 가능한 종류면 "다시 시도"를 보인다 */
  retryable: boolean;
  onSubmit: (draft: UploadDraft) => void;
  onRetry: () => void;
  /** 실패한 곡 다시 올리기: 제목·아티스트를 미리 채우고 파일만 다시 고르게 한다 */
  prefill: { title: string; artist: string } | null;
  onCancelPrefill: () => void;
  /** 제목 입력의 처음 값(악보에 곡 올리기: 악보 제목). 다시 올리기 배너 없이 제목만 채운다. 마운트 시 한 번만 읽는다 */
  initialTitle?: string;
  /** 있으면 하단에 [취소]를 둔다(업로드 창) */
  onCancel?: () => void;
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

const limitMib = Math.round(MAX_AUDIO_BYTES / 1024 / 1024);

export function AudioDropzone({ busy, error, retryable, onSubmit, onRetry, prefill, onCancelPrefill, initialTitle, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<PrecheckResult | null>(null);
  const [title, setTitle] = useState(prefill?.title ?? initialTitle ?? '');
  const [artist, setArtist] = useState(prefill?.artist ?? '');
  const [dragging, setDragging] = useState(false);
  // 파일·제목·아티스트 조합마다 키 하나. 바뀌면 null로 두고 제출 때 새로 만든다
  const keyRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 파일 입력은 hidden이라 포커스를 받지 못한다. 키보드로 파일 선택을 여는 [파일 고르기] 버튼에 둔다
  const dropRef = useRef<HTMLButtonElement>(null);

  // 프리필은 마운트 시 초기값으로 받는다. 값이 바뀌면 부모가 key를 바꿔 새로 마운트한다(파일·검사 결과·멱등 키도 초기화)
  useEffect(() => {
    if (prefill) dropRef.current?.focus({ preventScroll: true });
  }, [prefill]);

  const pick = (f: File | null) => {
    keyRef.current = null;
    setFile(f);
    if (!f) {
      setCheck(null);
      return;
    }
    setCheck(precheckAudio(f));
    // 제목이 비어 있을 때만 파일명을 기본값으로 쓴다(다시 올리기의 미리 채운 제목·직접 친 제목은 유지)
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
    keyRef.current ??= newIdempotencyKey();
    onSubmit({ file, title: trimmedTitle, artist: artist.trim(), idempotencyKey: keyRef.current });
  };

  return (
    <div className="studio-form">
      {prefill && (
        <div className="studio-reupload">
          <span>「{prefill.title}」 다시 올리기 — 파일만 다시 골라 주세요</span>
          <Button variant="text" size="sm" onClick={onCancelPrefill}>
            취소
          </Button>
        </div>
      )}
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
        <input ref={inputRef} type="file" accept=".mp3,.wav,.m4a,.opus,.ogg,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg,audio/opus" hidden onChange={onInput} disabled={busy} />
        <span className="studio-drop-icon">
          <UploadIcon size={32} />
        </span>
        <span className="studio-drop-title">
          {file ? `${file.name} · ${mib(file.size)}` : '음원 파일을 여기에 끌어다 놓으세요'}
        </span>
        <Button
          ref={dropRef}
          variant="secondary"
          size="sm"
          className="studio-drop-btn"
          disabled={busy}
          aria-label="음원 파일 선택"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          {file ? '다른 파일 고르기' : '파일 고르기'}
        </Button>
        <span className="studio-drop-limits">MP3·WAV·M4A·OPUS · {limitMib}MiB 이하 · 10분 이하</span>
      </div>
      {/* 보관 정책 안내(CHART 설계) — Figma 양식에는 없지만 개인정보 안내라 유지한다 */}
      <p className="studio-policy-note">
        올린 음원과 분리한 드럼 트랙은 채보를 만든 뒤 지워요. 드럼을 뺀 반주는 본인만 들을 수 있게 보관하고, 다운로드·공유는 제공하지 않아요.
      </p>
      {check && !check.ok && (
        <p className="notice error" role="alert">
          {PRECHECK_TEXT[check.reason]}
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
          onChange={(e) => {
            keyRef.current = null;
            setTitle(e.target.value);
          }}
          placeholder="파일 이름으로 채워져요"
        />
        <Input
          label="아티스트 (선택)"
          help={`${MAX_TITLE_LEN}자까지`}
          type="text"
          value={artist}
          maxLength={MAX_TITLE_LEN}
          disabled={busy}
          onChange={(e) => {
            keyRef.current = null;
            setArtist(e.target.value);
          }}
          placeholder="아티스트 이름"
        />
      </div>

      {error && (
        <div className="notice error row" role="alert" style={{ justifyContent: 'space-between' }}>
          <span>{error}</span>
          {retryable && (
            <Button variant="text" size="sm" onClick={onRetry} disabled={busy}>
              다시 시도
            </Button>
          )}
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
