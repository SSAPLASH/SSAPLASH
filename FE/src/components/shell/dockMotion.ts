// Dock·패널 전환 상수. Figma의 0.2s Ease out과 맞춘다(설계 3-1).
export const DOCK_TRANSITION = { duration: 0.2, ease: 'easeOut' } as const;
// 접힘 ↔ 펼침: 안쪽 묶음이 폭 0 ↔ 제 폭으로 미끄러진다(설계 QA-page-header-dock-fold). 틀 전체 페이드는 쓰지 않는다
export const DOCK_SLIDE = {
  hidden: { width: 0, opacity: 0 },
  shown: { width: 'auto', opacity: 1 },
} as const;
// 메트로놈 패널 Popover 전환 열림·닫힘
export const PANEL_TRANSITION = { duration: 0.15 } as const;
