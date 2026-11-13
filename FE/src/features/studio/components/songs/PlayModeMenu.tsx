// [▶ 플레이] 버튼 + 모드 선택 메뉴 (Figma Studio / PlayModeMenu 1034:5280, 설계 CHART-003 4-2).
// 완료 곡 카드의 정보 줄 오른쪽에 둔다. 누르면 「리듬 게임」·「악보 연습」 두 항목이 뜨고, 항목은 곡을 고른 채 해당 화면으로 가는 링크다(start 없음).
// 열고 닫기·Esc·바깥 클릭은 공용 ui/Menu가 맡는다. 이 메뉴만 열릴 때 첫 항목에 초점을 두고 ↑/↓로 항목을 옮긴다.
import { Link } from 'react-router-dom';
import { Menu } from '@/components/ui/overlay/Menu';
import type { SongSummary } from '@/domain/song/songCatalog';
import { GameIcon, PlayIcon, SheetIcon } from '@/components/song/StudioIcons';
import '@/features/studio/components/studio.css';

interface Props {
  song: SongSummary;
  /** 메뉴가 열리고 닫힐 때 알린다(카드가 열린 동안 강조를 유지하는 데 쓴다) */
  onOpenChange?: (open: boolean) => void;
}

export function PlayModeMenu({ song, onOpenChange }: Props) {
  const query = `scope=MINE&song=${song.id}`;
  const items = [
    { key: 'game', to: `/play?${query}`, name: '리듬 게임', desc: '떨어지는 노트에 맞춰 점수 도전', icon: <GameIcon /> },
    { key: 'sheet', to: `/sheet?${query}`, name: '악보 연습', desc: '악보를 보며 내 속도로 연습', icon: <SheetIcon /> },
  ];

  return (
    <Menu
      align="end"
      className="studio-play-menu"
      menuClassName="studio-play-menu-list"
      menuLabel={`「${song.title}」 플레이 방식`}
      onOpenChange={onOpenChange}
      focusFirstItem
      arrowNav
      renderTrigger={({ triggerProps }) => (
        <button type="button" className="studio-play-btn" aria-label={`「${song.title}」 플레이`} {...triggerProps}>
          <PlayIcon size={14} />
          <span>플레이</span>
        </button>
      )}
    >
      {({ close }) =>
        items.map((item) => (
          <Link key={item.key} to={item.to} role="menuitem" className="studio-play-item" onClick={close}>
            <span className="studio-play-item-icon">{item.icon}</span>
            <span className="studio-play-item-text">
              <span className="studio-play-item-name">{item.name}</span>
              <span className="studio-play-item-desc">{item.desc}</span>
            </span>
            <span className="studio-play-item-chev" aria-hidden="true">
              ›
            </span>
          </Link>
        ))
      }
    </Menu>
  );
}
