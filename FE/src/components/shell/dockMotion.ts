// Dock·패널 전환 상수. Figma의 0.2s Ease out과 맞춘다(설계 3-1).
export const DOCK_TRANSITION = { duration: 0.2, ease: 'easeOut' } as const;
// 접힘 ↔ 펼침 때 틀이 출발하는 상태. 내용은 바로 바뀌고 틀만 이 값에서 제자리로 돌아온다(QA 352)
export const DOCK_SWAP_FROM = { opacity: 0.4, scale: 0.97 } as const;
// 메트로놈 패널 Popover 전환 열림·닫힘
export const PANEL_TRANSITION = { duration: 0.15 } as const;
