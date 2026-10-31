// 내 곡 카드의 ⋯ 메뉴 (설계 CHART-001 4-2, D5). 완료 곡 = 커버 변경·곡 정보 수정·곡 삭제, 실패 곡 = 곡 삭제만.
// 처리 중 곡에는 카드가 메뉴를 그리지 않는다. Esc·바깥 클릭으로 닫힌다.
import { Menu } from '@/components/ui/Menu';
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
  if (kinds.length === 0) return null;

  return (
    <Menu
      className="song-menu"
      menuClassName="song-menu-list"
      renderTrigger={({ triggerProps }) => (
        <button type="button" className="song-menu-btn" aria-label={`${title} 메뉴`} {...triggerProps}>
          ⋯
        </button>
      )}
    >
      {({ close }) =>
        kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            role="menuitem"
            className={kind === 'delete' ? 'danger' : undefined}
            onClick={() => {
              close();
              onPick(kind);
            }}
          >
            {KIND_LABEL[kind]}
          </button>
        ))
      }
    </Menu>
  );
}
