// 드럼 세팅 단계 팝업 틀(PLAY-004 D8). ui/Dialog를 감싸 제목 줄·[닫기]·본문을 갖춘다.
// 열림은 호출자가 마운트 여부로 정한다. 닫으면 useDialogFocus가 팝업을 열던 타일로 포커스를 돌린다.
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import './setup.css';

interface Props {
  /** 제목(예: 「스틱 연결」). aria-labelledby로 이어진다 */
  title: string;
  /** 제목 요소 id (한 화면에 둘이 열리지 않지만 단계별로 구분) */
  titleId: string;
  /** Esc·배경 클릭·[닫기] */
  onClose: () => void;
  children: ReactNode;
}

export function StepDialog({ title, titleId, onClose, children }: Props) {
  return (
    <Dialog className="setup-step-dialog" labelledBy={titleId} onClose={onClose}>
      <div className="setup-step-head">
        <h2 id={titleId}>{title}</h2>
        <Button variant="secondary" onClick={onClose}>
          닫기
        </Button>
      </div>
      <div className="setup-step-body">{children}</div>
    </Dialog>
  );
}
