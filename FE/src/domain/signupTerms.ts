// 가입 동의 약관 문구·판과 동의 상태 규칙 (설계 COACH-003-signup-consent 3-1절).
// 약관 원문이 확정되면 이 파일의 본문·판 문자열만 바꾼다. React·브라우저·fetch에 의존하지 않는다.

/** 약관 항목 id. BE 저장 필드 이름(`termsVersion`·`privacyVersion`·`dataConsentVersion`)의 앞부분과 같다 */
export type SignupTermId = 'terms' | 'privacy' | 'dataConsent';

export interface SignupTerm {
  id: SignupTermId;
  /** 항목 제목 (머리 줄) */
  title: string;
  /** 필수 항목이면 머리 줄에 [필수], 아니면 [선택]. 버튼 활성 조건은 필수 항목만 본다 */
  required: boolean;
  /** 문구 판. 서버는 해석하지 않고 저장만 하므로 형식은 자유다 (날짜 문자열) */
  version: string;
  /** 스크롤 상자 본문. 줄바꿈(\n)마다 한 단락 */
  body: string;
}

/** `POST /api/users/me/signup-consent` 본문 그대로. 연주 기록 활용은 필수라 agreed는 항상 true (메일 ACCT-001 회신 2) */
export interface ConsentVersions {
  termsVersion: string;
  privacyVersion: string;
  dataConsent: { agreed: true; version: string };
}

/** 가입 동의 카드 머리의 설명 문구 (Figma 440:19794) */
export const SIGNUP_INTRO =
  'SSAPLASH를 시작하려면 아래 필수 항목에 모두 동의해 주세요. 내용은 상자 안에서 스크롤해 읽을 수 있어요.';

/** 이용약관·개인정보 본문은 Figma 시안 문구다. 원문 확정 후 교체한다(설계 U2) */
export const SIGNUP_TERMS: readonly SignupTerm[] = [
  {
    id: 'terms',
    title: '서비스 이용약관',
    required: true,
    version: '2026-11-02',
    body: [
      '제1조(목적) 이 약관은 SSAPLASH(이하 「서비스」)의 이용 조건과 절차, 회원과 서비스의 권리·의무를 정해요.',
      '제2조(회원 가입) 소셜 계정으로 로그인하고 필수 항목에 동의하면 가입이 끝나요.',
      '제3조(회원 탈퇴) 설정 > 회원 탈퇴에서 언제든 탈퇴할 수 있어요.',
      '제4조(서비스 변경) 서비스 내용이 바뀌면 미리 알려 드려요.',
      '(시안 문구 — 약관 원문 확정 후 교체)',
    ].join('\n'),
  },
  {
    id: 'privacy',
    title: '개인정보 수집·이용 동의',
    required: true,
    version: '2026-11-02',
    body: [
      '1. 수집 항목: 소셜 로그인 계정 식별 정보(로그인 제공자, 식별자), 프로필 이름',
      '2. 이용 목적: 회원 식별, 연주 기록·라이브러리 저장과 불러오기',
      '3. 보관 기간: 회원 탈퇴 시까지',
      '4. 동의하지 않으면 가입할 수 없어요.',
      '(시안 문구 — BE 수집 항목 확정 후 교체)',
    ].join('\n'),
  },
  {
    id: 'dataConsent',
    title: '연주 기록 활용 동의',
    // 필수 동의로 확정(메일 ACCT-001 회신 2). 철회는 회원 탈퇴로만 한다
    required: true,
    // 배포 전이라 철회 문구를 넣어도 판은 그대로 둔다
    version: '2026-11-02',
    body: [
      '1. 수집·이용 항목: 연주 중 타격 기록(타격 시각, 패드, 세기, 판정, 오차)',
      '2. 이용 목적: 약점 분석 기준을 더 정확하게 만드는 통계 분석',
      '3. 처리 방식: 분석 전에 누구의 기록인지 알 수 없도록 비식별 처리하고, 계정 정보는 쓰지 않아요.',
      '4. 보관: 회원 탈퇴 시 계정과 연주 기록은 삭제되지만, 비식별 처리돼 통계에 반영된 값은 신원 정보 없이 남아요.',
      '5. 이 항목은 서비스 이용에 필요한 필수 항목이에요. 동의하지 않으면 가입할 수 없어요.',
      '6. 동의 철회는 회원 탈퇴로 할 수 있어요.',
    ].join('\n'),
  },
];

/** 약관 항목 하나의 판. 항목이 없으면 빈 문자열 */
export function termVersion(id: SignupTermId, terms: readonly SignupTerm[] = SIGNUP_TERMS): string {
  return terms.find((t) => t.id === id)?.version ?? '';
}

/** 현재 약관 판을 BE 저장 본문 모양으로 묶는다 */
export function currentConsentVersions(terms: readonly SignupTerm[] = SIGNUP_TERMS): ConsentVersions {
  return {
    termsVersion: termVersion('terms', terms),
    privacyVersion: termVersion('privacy', terms),
    dataConsent: { agreed: true, version: termVersion('dataConsent', terms) },
  };
}

/** 연주 기록 활용 항목의 판. 없으면 빈 문자열. 설정 토글·업로드 동의 판단이 이 판 하나만 쓴다(설계 D13) */
export function dataConsentVersion(terms: readonly SignupTerm[] = SIGNUP_TERMS): string {
  return termVersion('dataConsent', terms);
}

/** 필수 항목이 전부 동의됐는가 — [동의하고 시작하기] 활성 조건 */
export function allRequiredAgreed(agreed: ReadonlySet<SignupTermId>, terms: readonly SignupTerm[] = SIGNUP_TERMS): boolean {
  return terms.every((t) => !t.required || agreed.has(t.id));
}

/** 선택 항목까지 전부 동의됐는가 — 「모두 동의합니다」 체크 표시 */
export function allAgreed(agreed: ReadonlySet<SignupTermId>, terms: readonly SignupTerm[] = SIGNUP_TERMS): boolean {
  return terms.length > 0 && terms.every((t) => agreed.has(t.id));
}

/** 「모두 동의」 클릭: 전부 켜져 있으면 전부 끄고, 아니면 전부 켠다. 새 집합을 돌려준다 */
export function toggleAll(agreed: ReadonlySet<SignupTermId>, terms: readonly SignupTerm[] = SIGNUP_TERMS): Set<SignupTermId> {
  return allAgreed(agreed, terms) ? new Set() : new Set(terms.map((t) => t.id));
}

/** 항목 하나를 넣거나 뺀 새 집합 */
export function toggleOne(agreed: ReadonlySet<SignupTermId>, id: SignupTermId): Set<SignupTermId> {
  const next = new Set(agreed);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
