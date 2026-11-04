// Dock·패널 전환 상수. Figma의 0.2s Ease out과 맞춘다(설계 3-1).
export const DOCK_TRANSITION = { duration: 0.2, ease: 'easeOut' } as const;
// 메트로놈 패널 Popover 전환 열림·닫힘
export const PANEL_TRANSITION = { duration: 0.15 } as const;
// 모서리 반경(px): 접힘 알약 / 펼침 막대. glass-dock.css의 값과 같아야 한다.
export const DOCK_RADIUS_COLLAPSED = 18;
export const DOCK_RADIUS_EXPANDED = 20;
