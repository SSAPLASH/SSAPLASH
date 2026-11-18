// 곡 ⋯ 메뉴 (Figma Studio / MoreMenu 212:757). 완료 곡 = 커버 변경·곡 정보 수정·곡 삭제, 실패 곡 = 곡 삭제만. 삭제 앞에 구분선, 삭제 글자는 위험 색.
// 처리 중 곡에는 메뉴를 그리지 않는다. 트리거는 IconButton sm(32). Esc·바깥 클릭으로 닫힌다(공용 ui/MoreMenu 사용). 카드는 커버 위, 목록 행은 행 끝에 둔다.
import { MoreMenu } from '@/components/ui/overlay/MoreMenu';
import { menuKinds, type SongEditKind, type SongSheetKind } from '@/domain/song/songEdit';

export type { SongEditKind, SongSheetKind };

const KIND_LABEL: Record<SongEditKind | SongSheetKind, string> = {
  cover: '커버 변경',
  meta: '곡 정보 수정',
  delete: '곡 삭제',
  sheetView: '악보 보기',
  sheetUpload: '악보 올리기',
};

interface Props {
  title: string;
  status: string;
  onPick: (kind: SongEditKind) => void;
  /** 있으면 완료 곡 메뉴에 [악보 보기 | 악보 올리기]가 들어간다. 없으면 메뉴는 그대로 */
  sheet?: { sheetId: number | null; onPick: (kind: SongSheetKind) => void };
  /** 트리거를 감싸는 요소의 클래스. 카드는 커버 위 오른쪽 위에 겹쳐 놓는다 */
  className?: string;
}

export function SongMenu({ title, status, onPick, sheet, className }: Props) {
  const kinds = menuKinds(status, sheet);
  return (
    <MoreMenu
      label={`${title} 메뉴`}
      className={className}
      items={kinds.map((kind) => ({ key: kind, label: KIND_LABEL[kind], danger: kind === 'delete' }))}
      onPick={(key) => {
        if (key === 'sheetView' || key === 'sheetUpload') sheet?.onPick(key);
        else onPick(key as SongEditKind);
      }}
    />
  );
}
