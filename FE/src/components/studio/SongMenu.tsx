// 곡 ⋯ 메뉴 (Figma Studio / MoreMenu 212:757). 완료 곡 = 커버 변경·곡 정보 수정·곡 삭제, 실패 곡 = 곡 삭제만. 삭제 앞에 구분선, 삭제 글자는 위험 색.
// 처리 중 곡에는 메뉴를 그리지 않는다. 트리거는 IconButton sm(32). Esc·바깥 클릭으로 닫힌다. 카드는 커버 위, 목록 행은 행 끝에 둔다.
import { IconButton } from '@/components/ui/IconButton';
import { Menu } from '@/components/ui/Menu';
import { menuKinds, type SongEditKind } from '@/domain/songEdit';
import { MoreIcon } from './StudioIcons';
import './studio.css';

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
  /** 트리거를 감싸는 요소의 클래스. 카드는 커버 위 오른쪽 위에 겹쳐 놓는다 */
  className?: string;
}

export function SongMenu({ title, status, onPick, className }: Props) {
  const kinds = menuKinds(status);
  if (kinds.length === 0) return null;

  return (
    <Menu
      className={['song-menu', className ?? ''].filter(Boolean).join(' ')}
      menuClassName="song-menu-list"
      renderTrigger={({ triggerProps }) => (
        <IconButton size="sm" label={`${title} 메뉴`} className="song-menu-btn" {...triggerProps}>
          <MoreIcon />
        </IconButton>
      )}
    >
      {({ close }) =>
        kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            role="menuitem"
            className={kind === 'delete' ? 'song-menu-item danger' : 'song-menu-item'}
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
