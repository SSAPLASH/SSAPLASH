// Figma Play / AccompanimentBar 226:5535 (none 변이) — 자유 연습 상단 반주 바.
// 반주 재생(playing 변이)은 S15P31A307-201. 지금은 안내 문구와 [반주 고르기] 진입점만 둔다.
import { Button } from '@/components/ui/Button';
import './free.css';

interface Props {
  /** 없으면 [반주 고르기]를 비활성(툴팁 "곧 지원")으로 그린다 */
  onPick?: () => void;
}

export function AccompanimentBar({ onPick }: Props) {
  return (
    <div className="free-accomp">
      <span className="free-accomp-label">반주</span>
      <p className="free-accomp-text">반주 없이 연습 중 · 라이브러리의 완료된 곡을 반주로 틀 수 있어요</p>
      <Button variant="secondary" onClick={onPick} disabled={!onPick} title={onPick ? undefined : '곧 지원'}>
        반주 고르기
      </Button>
    </div>
  );
}
