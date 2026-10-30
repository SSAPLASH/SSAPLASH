// 내 곡 카드의 ⋯ 메뉴 (설계 CHART-001 4-2, D5). 완료 곡 = 커버 변경·곡 정보 수정·곡 삭제, 실패 곡 = 곡 삭제만.
// 처리 중 곡에는 카드가 메뉴를 그리지 않는다. Esc·바깥 클릭으로 닫힌다.
import { useEffect, useRef, useState } from 'react';
import { menuKinds, type SongEditKind } from '@/domain/songEdit';

export type { SongEditKind };

const KIND_LABEL: Record<SongEditKind, string> = {
  cover: '커버 변경',
  meta: '곡 정보 수정',
  delete: '곡 삭제',
};

interface Props {
  title: string;
  status: string;
  onPick: (kind: SongEditKind) => void;
}

export function SongMenu({ title, status, onPick }: Props) {
  const kinds = menuKinds(status);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (kind: SongEditKind) => {
    setOpen(false);
    onPick(kind);
  };

  if (kinds.length === 0) return null;

  return (
    <div className="song-menu" ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className="song-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${title} 메뉴`}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="song-menu-list" role="menu">
          {kinds.map((kind) => (
            <button key={kind} type="button" role="menuitem" className={kind === 'delete' ? 'danger' : undefined} onClick={() => pick(kind)}>
              {KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
