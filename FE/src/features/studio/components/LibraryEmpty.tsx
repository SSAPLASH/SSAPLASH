// 라이브러리 빈 안내 (설계 QA-studio-empty-state). 곡·악보·진행 작업이 모두 없을 때 카드·목록 영역 자리에 둔다.
// 올리기 진입점은 헤더 [+ 올리기] 하나라서 여기에는 버튼을 두지 않는다.
import type { StudioView } from './songs/MySongList';
import './studio.css';

interface Props {
  /** 카드 보기는 그리드 폭 점선 상자, 목록 보기는 목록 틀 안 한 칸 */
  view: StudioView;
  /** 악보 기능이 켜져 있으면 문구에 악보를 넣는다 */
  sheetsEnabled: boolean;
}

export function LibraryEmpty({ view, sheetsEnabled }: Props) {
  return (
    <div className={`studio-empty ${view === 'card' ? 'card' : 'list'}`} role="status">
      <p className="studio-empty-title">{sheetsEnabled ? '나만의 곡과 악보를 추가해 봐요!' : '나만의 곡을 추가해 봐요!'}</p>
      <p className="studio-empty-desc">
        {sheetsEnabled ? '오른쪽 위 [+ 올리기]로 음원·MIDI·악보를 올릴 수 있어요' : '오른쪽 위 [+ 곡 올리기]로 음원이나 MIDI를 올릴 수 있어요'}
      </p>
    </div>
  );
}
