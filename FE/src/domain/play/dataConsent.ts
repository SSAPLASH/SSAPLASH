// 연주 기록 활용 동의의 순수 규칙 (설계 COACH-003-signup-consent 3-5절).
// 서버 값이 지금 판에 동의한 것인지, 로그의 동의를 업로드에 어떻게 싣는지만 정한다. 동의는 가입 때 필수이고 철회는 탈퇴뿐이라 FE가 바꾸는 API는 없다.
// React·브라우저·fetch·store에 의존하지 않는다.
import type { DataConsent } from '@/domain/account/auth';
import { dataConsentVersion } from '@/domain/account/signupTerms';
import type { PlayLog } from './playLog';

/** 서버 값이 현재 판에 동의한 상태인가. 없음·null·거부·판 불일치는 모두 false */
export function isConsentCurrent(dc: DataConsent | null | undefined, version: string = dataConsentVersion()): boolean {
  return dc?.agreed === true && dc.version === version;
}

/** 업로드 본문의 consent. 필드 없는 옛 로그는 false (설계 D19) */
export function logConsent(log: Pick<PlayLog, 'consent'>): boolean {
  return log.consent === true;
}
