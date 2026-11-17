// 상단 바(Figma Navigation / TopBar 126:2123, 높이 56). 왼쪽에 제목, 오른쪽은 비운다.
// Dock·StickStatus·아바타는 셸 루트에 fixed로 겹쳐 놓인다(D3). InfoBar 변이는 만들지 않는다.
import { useLocation } from 'react-router-dom';
import { sensorRegistry } from '@/runtime/sensorRegistry';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { useShellStore } from '@/store/shellStore';
import { defaultTitle } from './defaultTitles';

export function TopBar() {
  const title = useShellStore((s) => s.title);
  const { pathname } = useLocation();
  const sourceState = useLive((s) => s.sourceState);
  const sensorKind = useSettings((s) => s.sensorKind);

  return (
    <header className="topbar">
      <div className="topbar-heading">
        {/* 로고 S 심벌(public/images/ssaplash-symbol.webp, 113×96). 장식이라 읽지 않는다 */}
        <img
          className="brand-symbol topbar-logo"
          src="/images/ssaplash-symbol.webp"
          alt=""
          aria-hidden="true"
          width={113}
          height={96}
          draggable={false}
        />
        <h1 className="topbar-title t-title-20" tabIndex={-1}>{title || defaultTitle(pathname)}</h1>
      </div>
      {/* Figma에 없는 센서 종류 표시. 기능 손실을 피하려 제목 옆에 작게 남긴다 */}
      <span className="small dim topbar-sensor">
        {sensorKind === 'none' ? '키보드' : (sensorRegistry.get(sensorKind)?.label ?? sensorKind)}
        {sensorKind !== 'none' && ' + 키보드'}
        {sourceState === 'connecting' && ' · 연결 중'}
        {sourceState === 'error' && ' · 오류'}
      </span>
    </header>
  );
}
