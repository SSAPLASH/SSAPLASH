// 설정 행 — 왼쪽 라벨(16)·도움말(13), 오른쪽 control 슬롯. props만 받는다.
// 라벨·도움말 id를 만들어 children에 aria 속성으로 넘기므로, control에 펼치면 접근 이름·설명이 이어진다.
import { useId } from 'react';
import type { ReactNode } from 'react';
import './settings.css';

export interface RowAria {
  'aria-labelledby': string;
  'aria-describedby': string;
}

interface Props {
  label: string;
  help?: string;
  /** control. 받은 aria 속성을 Toggle·Slider 등에 펼쳐 넣는다 */
  children: (aria: RowAria) => ReactNode;
  /** control이 넓은 행(슬라이더)은 오른쪽 폭을 고정한다 */
  wideControl?: boolean;
  /** control을 라벨·도움말 아래 전체 폭으로 둔다(캐러셀). 라벨 id는 aria-labelledby로 넘어간다 */
  stacked?: boolean;
}

export function SettingRow({ label, help, children, wideControl = false, stacked = false }: Props) {
  const id = useId();
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  return (
    <div className={`settings-row${stacked ? ' stacked' : ''}`}>
      <div className="settings-row-text">
        <span id={labelId} className="settings-row-label">
          {label}
        </span>
        {help ? (
          <span id={helpId} className="settings-row-help">
            {help}
          </span>
        ) : null}
      </div>
      <div className={`settings-row-control${wideControl ? ' wide' : ''}`}>
        {children({ 'aria-labelledby': labelId, 'aria-describedby': help ? helpId : labelId })}
      </div>
    </div>
  );
}
