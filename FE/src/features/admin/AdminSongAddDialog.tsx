// 공용 곡 추가 창 (Jira 262). MIDI·제목·아티스트·출처·라이선스·첫 박 시각(선택)·공개·반주(선택). 검사는 domain, 호출은 onSubmit을 받은 쪽이 한다.
// saving(등록·반주 업로드 중)이면 닫기·Esc·배경 클릭을 막는다.
import { useState } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Checkbox } from '@/components/ui/form/Checkbox';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { IconButton } from '@/components/ui/action/IconButton';
import { Input } from '@/components/ui/form/Input';
import {
  ADMIN_DRAFT_TEXT,
  ADMIN_LICENSE_EXAMPLE,
  MAX_ADMIN_ARTIST_LEN,
  MAX_ADMIN_TITLE_LEN,
  MAX_LICENSE_LEN,
  validateAdminDraft,
  type AdminSongDraft,
} from './adminSong';
import './admin.css';

interface Props {
  busy: boolean;
  /** 마지막 등록 실패 문구 */
  error: string | null;
  onSubmit: (draft: AdminSongDraft) => void;
  onClose: () => void;
}

/** 파일 이름에서 확장자를 뗀 기본 제목 */
function titleFromFile(name: string): string {
  return name.replace(/\.(mid|midi)$/i, '').slice(0, MAX_ADMIN_TITLE_LEN).trim();
}

export function AdminSongAddDialog({ busy, error, onSubmit, onClose }: Props) {
  const [draft, setDraft] = useState<AdminSongDraft>({
    file: null,
    title: '',
    artist: '',
    license: '',
    offsetMs: '',
    published: true,
    accompaniment: null,
  });
  const set = (patch: Partial<AdminSongDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const check = validateAdminDraft(draft);
  // 아직 손대지 않은 필수 칸(파일·제목·라이선스 없음)은 안내만 하고 오류로 띄우지 않는다
  const untouched = !check.ok && (check.reason === 'NO_FILE' || (check.reason === 'TITLE' && draft.title === '') || (check.reason === 'LICENSE' && draft.license === ''));
  const canSubmit = !busy && check.ok;

  return (
    <Dialog className="admin-dialog" labelledBy="admin-add-title" closeOnBackdrop={!busy} closeOnEscape={!busy} onClose={onClose}>
      <div className="admin-dialog-head">
        <h2 id="admin-add-title">공용 곡 추가</h2>
        <IconButton size="sm" label="닫기" onClick={onClose} disabled={busy}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </IconButton>
      </div>
      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit(draft);
        }}
      >
        <label className="admin-file">
          <span className="admin-file-label">MIDI 파일</span>
          <input
            type="file"
            aria-label="MIDI 파일"
            accept=".mid,.midi,audio/midi,audio/x-midi"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              set({ file, title: draft.title.trim() === '' && file ? titleFromFile(file.name) : draft.title });
            }}
          />
          <span className="admin-file-help">.mid · 1 MiB 이하 · 드럼은 10번 채널 · 쉬움·보통·어려움이 자동으로 만들어져요</span>
        </label>
        <Input
          label="곡 제목 *"
          help={`1~${MAX_ADMIN_TITLE_LEN}자 · 같은 제목의 공용 곡과 구분되지 않으니 정확히 적어 주세요`}
          type="text"
          value={draft.title}
          maxLength={MAX_ADMIN_TITLE_LEN + 20}
          disabled={busy}
          onChange={(e) => set({ title: e.target.value })}
        />
        <Input
          label="아티스트 (선택)"
          help={`${MAX_ADMIN_ARTIST_LEN}자까지`}
          type="text"
          value={draft.artist}
          maxLength={MAX_ADMIN_ARTIST_LEN + 20}
          disabled={busy}
          onChange={(e) => set({ artist: e.target.value })}
        />
        <Input
          label="출처·라이선스 *"
          help={`1~${MAX_LICENSE_LEN}자 · 예: ${ADMIN_LICENSE_EXAMPLE}`}
          type="text"
          value={draft.license}
          maxLength={MAX_LICENSE_LEN + 20}
          disabled={busy}
          onChange={(e) => set({ license: e.target.value })}
        />
        <Input
          label="첫 박 시각 ms (선택)"
          help="AI MIDI(0틱 = 음원 0초)는 곡별 첫 박 표의 값을 적어요. 직접 만든 MIDI는 비워 두세요"
          type="text"
          inputMode="numeric"
          value={draft.offsetMs}
          disabled={busy}
          onChange={(e) => set({ offsetMs: e.target.value })}
        />
        <label className="admin-file">
          <span className="admin-file-label">반주 파일 (선택)</span>
          <input
            type="file"
            aria-label="반주 파일"
            accept=".wav,.mp3,audio/wav,audio/mpeg"
            disabled={busy}
            onChange={(e) => set({ accompaniment: e.target.files?.[0] ?? null })}
          />
          <span className="admin-file-help">WAV·MP3 · 50 MiB·10분 이하 · 드럼 없는 음원, MIDI와 같은 0초 기준</span>
        </label>
        <Checkbox checked={draft.published} onChange={(v) => set({ published: v })} disabled={busy} label="바로 공개 (끄면 관리자만 보여요)" />

        {!check.ok && !untouched && (
          <p className="notice error" role="alert">
            {ADMIN_DRAFT_TEXT[check.reason]}
          </p>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="admin-footer">
          <Button variant="secondary" size="md" className="admin-footer-btn" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button type="submit" variant="primary" size="md" className="admin-footer-btn" disabled={!canSubmit}>
            {busy ? '등록 중…' : '등록'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
