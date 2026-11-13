// 악보 ⋯ 메뉴 (설계 CHART-001 악보 보관 2·4-2). 악보만 있는 항목·뷰어 공용: 제목 수정, 악보 삭제(위험 색·위 구분선).
// 트리거는 SongMenu와 같은 공용 ui/MoreMenu. 선택만 알리고 실제 처리는 호출자가 한다.
import { MoreMenu } from '@/components/ui/overlay/MoreMenu';

export type SheetMenuKind = 'rename' | 'delete';

const ITEMS = [
  { key: 'rename', label: '제목 수정' },
  { key: 'delete', label: '악보 삭제', danger: true },
];

export function SheetMenu(props: { title: string; onPick: (kind: SheetMenuKind) => void; className?: string }) {
  const { title, onPick, className } = props;
  return <MoreMenu label={`${title} 메뉴`} className={className} items={ITEMS} onPick={(key) => onPick(key as SheetMenuKind)} />;
}
