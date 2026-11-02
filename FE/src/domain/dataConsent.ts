// 연주 기록 활용 동의의 순수 규칙 (설계 COACH-003-signup-consent 3-5절).
// 서버 값이 지금 판에 동의한 것인지, 옛 브라우저 값을 어떻게 처리할지, 로그의 동의를 업로드에 어떻게 싣는지만 정한다.
// React·브라우저·fetch·store에 의존하지 않는다.
import type { DataConsent } from './auth';
import { dataConsentVersion } from './signupTerms';
import type { PlayLog } from '@/engine/playLog';

/** 서버 값이 현재 판에 동의한 상태인가. 없음·null·거부·판 불일치는 모두 false */
export function isConsentCurrent(dc: DataConsent | null | undefined, version: string = dataConsentVersion()): boolean {
  return dc?.agreed === true && dc.version === version;
}

/** 옛 브라우저 값(settingsStore.statsConsent) 처리: 서버로 올림 · 올리지 않고 비움 · 할 일 없음 */
export type LegacyConsentAction = 'upload' | 'clear' | 'none';

/**
 * 브라우저 값이 false면 할 일 없음. true인데 서버가 답한 적 없으면 올리고,
 * 서버에 이미 값이 있으면(다른 기기에서 답함) 덮지 않고 브라우저 값만 비운다(설계 D17).
 */
export function legacyConsentAction(dc: DataConsent | null | undefined, browserValue: boolean): LegacyConsentAction {
  if (!browserValue) return 'none';
  if (!dc || dc.agreed === null) return 'upload';
  return 'clear';
}

/** 업로드 본문의 consent. 필드 없는 옛 로그는 false (설계 D19) */
export function logConsent(log: Pick<PlayLog, 'consent'>): boolean {
  return log.consent === true;
}
