// 공용 곡 표 (Jira 262). 행마다 반주 올리기/교체 — 숨긴 파일 입력을 버튼으로 연다. 업로드 호출은 하지 않고 onUpload로 넘긴다.
import { useRef } from 'react';
import { Button } from '@/components/ui/action/Button';
import type { AdminSong } from './adminSong';
import '@/components/ui/layout/table.css';
import './admin.css';

interface Props {
  songs: AdminSong[];
  uploading: Record<number, true>;
  rowErrors: Record<number, string>;
  onUpload: (id: number, file: File) => void;
}

const DIFFICULTY_SHORT: Record<string, string> = { EASY: 'E', NORMAL: 'N', HARD: 'H' };

function AccompanimentAction({ song, busy, error, onUpload }: { song: AdminSong; busy: boolean; error: string | undefined; onUpload: Props['onUpload'] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const verb = song.hasAccompaniment ? '반주 교체' : '반주 올리기';
  return (
    <div className="admin-row-action">
      <input
        ref={inputRef}
        type="file"
        accept=".wav,.mp3,audio/wav,audio/mpeg"
        hidden
        aria-label={`${song.title} 반주 파일`}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // 같은 파일을 다시 골라도 change가 나도록 비운다
          e.target.value = '';
          if (file) onUpload(song.id, file);
        }}
      />
      <Button variant="secondary" size="sm" disabled={busy} aria-label={`${song.title} ${verb}`} onClick={() => inputRef.current?.click()}>
        {busy ? '올리는 중…' : verb}
      </Button>
      {error && (
        <p className="admin-row-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function AdminSongTable({ songs, uploading, rowErrors, onUpload }: Props) {
  return (
    <div className="admin-table-wrap">
      <table className="ui-table admin-table" aria-label="공용 곡">
        <thead>
          <tr>
            <th scope="col">제목</th>
            <th scope="col">아티스트</th>
            <th scope="col">난이도</th>
            <th scope="col">반주</th>
            <th scope="col">공개</th>
            <th scope="col" aria-label="동작" />
          </tr>
        </thead>
        <tbody>
          {songs.map((s) => (
            <tr key={s.id}>
              <td>{s.title}</td>
              <td className="admin-artist">{s.artist ?? '—'}</td>
              <td>{s.difficulties.map((d) => DIFFICULTY_SHORT[d] ?? d).join('·') || '—'}</td>
              <td className={s.hasAccompaniment ? 'admin-yes' : 'admin-no'}>{s.hasAccompaniment ? '있음' : '없음'}</td>
              <td className={s.published ? 'admin-yes' : 'admin-no'}>{s.published ? '공개' : '비공개'}</td>
              <td>
                <AccompanimentAction song={s} busy={uploading[s.id] === true} error={rowErrors[s.id]} onUpload={onUpload} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
