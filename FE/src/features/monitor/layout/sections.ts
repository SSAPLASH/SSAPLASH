// 사이드바·개요·섹션 본문이 함께 쓰는 섹션 정의와 상태 헬퍼. 컴포넌트가 아니라 별도 파일에 둔다(fast refresh).
import type { HealthLevel, StageHealth } from '@/features/monitor/core/health';

export type Section = 'overview' | 'transport' | 'sensor' | 'clock' | 'resolve' | 'score' | 'output' | 'trace' | 'free' | 'control';

/** 사이드바 항목. divider는 해당 항목 앞에 구분선을 둔다 */
export const SECTION_ITEMS: { key: Section; label: string; divider?: boolean }[] = [
  { key: 'overview', label: '개요' },
  { key: 'transport', label: '① 전송' },
  { key: 'sensor', label: '② 센서' },
  { key: 'clock', label: '③ 시계' },
  { key: 'resolve', label: '④ 판정' },
  { key: 'score', label: '⑤ 채점' },
  { key: 'output', label: '⑥ 출력' },
  { key: 'trace', label: '타격 추적', divider: true },
  { key: 'free', label: '자유 연습 실측' },
  { key: 'control', label: '제어' },
];

/** 상태가 계산되는 단계. 나머지 항목은 idle로 그린다 */
export type StageKey = 'transport' | 'sensor' | 'clock' | 'resolve' | 'score' | 'output';

export type StageHealthMap = Record<StageKey, StageHealth>;

export const LEVEL_LABEL: Record<HealthLevel, string> = { ok: '정상', warn: '주의', bad: '이상', idle: '데이터 없음' };

const STAGE_KEYS: readonly Section[] = ['transport', 'sensor', 'clock', 'resolve', 'score', 'output'];
const isStage = (key: Section): key is StageKey => STAGE_KEYS.includes(key);

export const sectionLevel = (key: Section, health: StageHealthMap): HealthLevel => (isStage(key) ? health[key].level : 'idle');

export const sectionReason = (key: Section, health: StageHealthMap): string | null => {
  if (isStage(key)) return health[key].reason;
  return null;
};
