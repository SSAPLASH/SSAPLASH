// 연주 중 옵션 카드 (Figma 악보 연습 준비 378:12946). 제목 + 체크 3줄. props만 받는다 — 설정 스토어 연결은 페이지가 한다.
// 체크는 네이티브 checkbox(접근성)에 토큰 색을 입힌다.
import { Card } from '@/components/ui/Card';
import { accompanimentOptionText, type AccompanimentStatus } from '@/domain/songCatalog';
import './play-options.css';

interface Props {
  metronome: boolean;
  onMetronome: (v: boolean) => void;
  padCount: boolean;
  onPadCount: (v: boolean) => void;
  /** 반주가 있는 곡인지. 없으면 「(반주 없음)」을 붙이고 비활성 */
  hasAccompaniment: boolean;
  /** 곡의 반주 생성 상태. 반주가 없을 때 괄호 문구를 고른다(생성 중 / 반주 없음). 모르면 「반주 없음」 */
  accompanimentStatus?: AccompanimentStatus | null;
}

export function PlayOptions({ metronome, onMetronome, padCount, onPadCount, hasAccompaniment, accompanimentStatus }: Props) {
  // READY인데 아직 못 불러온 경우도 비활성 문구가 비지 않게 「반주 없음」으로 둔다
  const missingText = accompanimentOptionText(accompanimentStatus) || '반주 없음';
  return (
    <Card padding="md" className="play-opt">
      <h3 className="play-opt-title">연주 중 옵션</h3>
      <label className="play-opt-row">
        <input type="checkbox" checked={metronome} onChange={(e) => onMetronome(e.target.checked)} />
        <span>메트로놈 클릭을 곡 중에도 낸다</span>
      </label>
      <label className="play-opt-row">
        <input type="checkbox" checked={padCount} onChange={(e) => onPadCount(e.target.checked)} />
        <span>드럼 패드 위에 다음 칠 박 번호를 보인다</span>
      </label>
      <label className={`play-opt-row${hasAccompaniment ? '' : ' disabled'}`}>
        <input type="checkbox" checked={hasAccompaniment} disabled readOnly />
        <span>반주 재생{hasAccompaniment ? '' : ` (${missingText})`}</span>
      </label>
    </Card>
  );
}
