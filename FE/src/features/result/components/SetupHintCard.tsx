// 연주 중 세팅 안내가 떴던 판의 결과 화면 카드. 어디서 고치는지 바로 갈 수 있게 한다.
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/layout/Card';
import { buttonClassName } from '@/components/ui/action/buttonStyle';

interface Props {
  /** 이 판에서 뜬 세팅 안내 태그 */
  tags: readonly string[];
  /** 세팅을 마치고 돌아올 주소 */
  returnTo: string;
}

export function SetupHintCard({ tags, returnTo }: Props) {
  const offset = tags.includes('LIVE_SETUP_OFFSET');
  const pads = tags.includes('LIVE_SETUP_PADS');
  if (!offset && !pads) return null;
  return (
    <Card title="세팅 확인하기">
      {offset && <p className="result-caption">타격이 일정하게 어긋났어요. 연주보다 소리 지연이 원인일 수 있어요.</p>}
      {pads && <p className="result-caption">다른 패드로 들어간 타격이 많았어요. 패드 위치를 다시 잡아 보세요.</p>}
      <div className="result-actions">
        {offset && (
          <Link to="/settings" className={buttonClassName({ variant: 'secondary', size: 'md' })}>
            박자 맞추러 가기
          </Link>
        )}
        {pads && (
          <Link to="/setup" state={{ returnTo, returnLabel: '결과' }} className={buttonClassName({ variant: 'secondary', size: 'md' })}>
            패드 다시 잡기
          </Link>
        )}
      </div>
    </Card>
  );
}
