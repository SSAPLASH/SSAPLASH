// 「강약중강약」 「내 세기」 한 줄 (설계 MODE-006-minigame-dynamics-match 4절). 감 잡기에서 친 약·중·강 값을 보인다. 숫자 맞추기 화면 위와 결과 판에 쓴다.
// 항목 사이 구분은 CSS 간격으로 한다. 값만 받는다.
import { LEVEL_LABEL, type FeelShot } from '@/features/mini/domain/dynamicsRound';
import './dynamics.css';

interface Props {
  feel: readonly FeelShot[];
}

export function FeelStrip({ feel }: Props) {
  if (feel.length === 0) return null;
  return (
    <div className="mini-dyn-feel" data-testid="mini-dyn-feel">
      <span className="mini-dyn-feel-label">내 세기</span>
      {feel.map((shot) => (
        <span key={shot.level} className="mini-dyn-feel-item">
          {LEVEL_LABEL[shot.level]} <strong>{shot.actual}</strong>
        </span>
      ))}
    </div>
  );
}
