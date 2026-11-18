// Figma ReturnBanner 236:1306 — 시작 확인 창에서 설정으로 온 사용자에게 상단에 고정하는 복귀 띠. 이동 자체는 하지 않는다(onReturn 콜백).
// blocked(준비 중) = brand 10% 배경·60% 테두리, ready = good 계열.
import { useEffect } from 'react';
import { Button } from '@/components/ui/action/Button';
import { shouldReturnOnEnter } from './preset/enterKey';
import './setup.css';

interface Props {
  title: string;
  line: string;
  buttonText: string;
  /** 준비 조건이 모두 충족돼 돌아갈 수 있는지 */
  ready: boolean;
  /** Enter 복귀를 허용할지. 대화상자·보정 중 등에는 호출자가 false로 둔다 */
  enterEnabled: boolean;
  onReturn: () => void;
}

export function ReturnBanner({ title, line, buttonText, ready, enterEnabled, onReturn }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return;
      if (!shouldReturnOnEnter(ready, enterEnabled, e.target as HTMLElement | null)) return;
      e.preventDefault();
      onReturn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, enterEnabled, onReturn]);

  return (
    <div className={`setup-banner ${ready ? 'ready' : 'blocked'}`} role="status">
      <div className="setup-banner-text">
        <strong>{title}</strong>
        <span>{line}</span>
      </div>
      <Button variant="primary" className="setup-banner-action" disabled={!ready} onClick={onReturn}>
        {buttonText}
      </Button>
    </div>
  );
}
