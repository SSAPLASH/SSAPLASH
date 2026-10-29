// 곡 올리기의 MIDI 탭 양식 (설계 CHART-002 2·3-5). 파일 선택·드롭, 제목(파일명 기본값)·아티스트, 사전 검사를 하고
// 업로드 호출은 하지 않는다 — 완성된 MidiDraft를 onSubmit으로 넘긴다. AudioDropzone과 같은 모양·접근성 패턴.
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { MAX_TITLE_LEN, defaultTitleFromFile } from '@/domain/chartJob';
import { MAX_MIDI_BYTES, MIDI_PRECHECK_TEXT, precheckMidi, type MidiDraft, type MidiPrecheck } from '@/domain/midiUpload';

export interface MidiUploadFormProps {
  /** 업로드 진행 중이면 입력을 잠근다 */
  busy: boolean;
  /** 업로드 실패 문구(store의 error). 있으면 버튼 위에 보인다 */
  error: string | null;
  onSubmit: (draft: MidiDraft) => void;
  /** 첫 방문(곡도 작업도 없음)의 큰 드롭 영역 */
  emphasis: boolean;
}

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function MidiUploadForm({ busy, error, onSubmit, emphasis }: MidiUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<MidiPrecheck | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    setFile(f);
    if (!f) {
      setCheck(null);
      return;
    }
    setCheck(precheckMidi(f));
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
    <div className="studio-form col">
      <div
        className={`studio-drop${emphasis ? ' large' : ''}${dragging ? ' over' : ''}${busy ? ' disabled' : ''}`}
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
        aria-label="MIDI 파일 선택"
      >
        <input ref={inputRef} type="file" accept=".mid,.midi,audio/midi,audio/x-midi" hidden onChange={onInput} disabled={busy} />
        {file ? (
          <>
            <strong>{file.name}</strong>
            <span className="small dim">{size(file.size)}</span>
          </>
        ) : (
          <>
            <strong>MIDI 파일을 여기에 놓거나 클릭해서 고르세요</strong>
            <span className="small dim">최대 {size(MAX_MIDI_BYTES)} · 드럼(채널 10) 노트가 있는 곡</span>
          </>
        )}
      </div>
      {check && !check.ok && (
        <p className="notice error" role="alert">
          {MIDI_PRECHECK_TEXT[check.reason]}
        </p>
      )}

      <label className="col" style={{ gap: 4 }}>
        <span className="small dim">곡 제목</span>
        <input type="text" value={title} maxLength={MAX_TITLE_LEN} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
      </label>
      <label className="col" style={{ gap: 4 }}>
        <span className="small dim">아티스트 (선택)</span>
        <input type="text" value={artist} maxLength={MAX_TITLE_LEN} disabled={busy} onChange={(e) => setArtist(e.target.value)} placeholder="아티스트" />
      </label>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn-primary" onClick={submit} disabled={!canSubmit}>
          {busy ? '업로드 중…' : '채보 만들기'}
        </button>
      </div>
      <p className="small faint">MIDI는 올리면 바로 쉬움·보통·어려움 채보가 만들어집니다. 반주는 없습니다.</p>
    </div>
  );
}
