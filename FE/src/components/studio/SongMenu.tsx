// 내 곡 카드의 ⋯ 메뉴 (설계 CHART-001 4-2). 커버 변경·표시명 변경·곡 삭제. Esc·바깥 클릭으로 닫힌다.
import { useEffect, useRef, useState } from 'react';

export type SongEditKind = 'cover' | 'meta' | 'delete';

interface Props {
  title: string;
  onPick: (kind: SongEditKind) => void;
}

export function SongMenu({ title, onPick }: Props) {
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
          <button type="button" role="menuitem" onClick={() => pick('cover')}>
            커버 변경
          </button>
          <button type="button" role="menuitem" onClick={() => pick('meta')}>
            표시명 변경
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => pick('delete')}>
            곡 삭제
          </button>
        </div>
      )}
    </div>
  );
}
