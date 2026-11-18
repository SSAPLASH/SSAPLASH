// 공용 ⋯ 메뉴 (Figma Studio / MoreMenu 212:757). Menu를 틀로, 트리거는 IconButton sm + ⋯ 아이콘.
// 항목이 없으면 아무것도 그리지 않는다. 삭제 같은 위험 항목은 danger로 표시한다(위험 색 + 위 구분선).
import { IconButton } from '@/components/ui/action/IconButton';
import { Menu } from './Menu';
import './MoreMenu.css';

export interface MoreMenuItem {
  key: string;
  label: string;
  danger?: boolean;
}

interface Props {
  /** 트리거 버튼의 aria-label */
  label: string;
  items: MoreMenuItem[];
  onPick: (key: string) => void;
  /** 트리거+팝오버를 감싸는 요소의 추가 클래스 */
  className?: string;
  /** 트리거 버튼의 추가 클래스 */
  triggerClassName?: string;
}

// studio/StudioIcons의 MoreIcon과 같은 모양(ui가 studio를 import하지 않도록 여기 둔다)
function MoreIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="currentColor" stroke="none">
      <circle cx="4.5" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="15.5" cy="10" r="1.6" />
    </svg>
  );
}

export function MoreMenu({ label, items, onPick, className, triggerClassName }: Props) {
  if (items.length === 0) return null;

  return (
    <Menu
      className={['ui-more-menu', className ?? ''].filter(Boolean).join(' ')}
      menuClassName="ui-more-menu-list"
      renderTrigger={({ triggerProps }) => (
        <IconButton
          size="sm"
          label={label}
          className={['ui-more-menu-btn', triggerClassName ?? ''].filter(Boolean).join(' ')}
          {...triggerProps}
        >
          <MoreIcon />
        </IconButton>
      )}
    >
      {({ close }) =>
        items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={item.danger ? 'ui-more-menu-item danger' : 'ui-more-menu-item'}
            onClick={() => {
              close();
              onPick(item.key);
            }}
          >
            {item.label}
          </button>
        ))
      }
    </Menu>
  );
}
