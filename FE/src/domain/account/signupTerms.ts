// 가입 동의 약관 문구·판과 동의 상태 규칙 (설계 COACH-003-signup-consent 3-1절, COACH-004-recommendation-consent D1~D3).
// 약관 원문이 확정되면 이 파일의 본문·판 문자열만 바꾼다. React·브라우저·fetch에 의존하지 않는다.

/** 약관 항목 id. BE 저장 필드 이름(`termsVersion`·`privacyVersion`·`dataConsentVersion`)의 앞부분과 같다 */
export type SignupTermId = 'terms' | 'privacy' | 'dataConsent' | 'recommendation';

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

/**
 * `POST /api/users/me/signup-consent` 본문 그대로. 연주 기록 활용은 필수라 agreed는 항상 true (메일 ACCT-001 회신 2).
 * 추천 학습 활용은 선택이지만 항상 싣는다 — BE는 생략하면 이전 응답을 유지해 신규 가입자가 "응답 안 함"으로 남기 때문이다(설계 D3)
 */
export interface ConsentVersions {
  termsVersion: string;
  privacyVersion: string;
  dataConsent: { agreed: true; version: string };
  recommendationConsent?: { agreed: boolean; version: string };
}

/** 검토된 본문과 허용 판이 배포되기 전까지 신규 동의 수집을 열지 않는다. */
export function recommendationConsentEnabled(): boolean {
  return import.meta.env.VITE_RECOMMENDATION_CONSENT_ENABLED === 'true';
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
  {
    id: 'recommendation',
    title: '곡 추천 개선을 위한 연주 기록 이용 동의',
    // 선택 항목이다. 2026-11-11 공개를 위해 본문 끝의 비활성 표시를 빼고 판을 올렸다(2026-11-05는 수집이 꺼진 초안 판).
    // 실제 수집은 빌드 설정 VITE_RECOMMENDATION_CONSENT_ENABLED와 BE SIGNUP_CONSENT_RECOMMENDATION_VERSIONS로 켠다.
    required: false,
    version: '2026-11-11',
    body: [
      '1. 이용 목적: 곡 추천 모델을 학습·평가하고 개선해요. 학습 결과는 다른 사용자의 추천에도 반영될 수 있어요.',
      '2. 이용 항목: 연주 기록 활용에 동의한 공용 곡의 기록 중 서비스에 보관 중인 과거 연주와 동의 이후 연주의 곡, 채보, 난이도, 연주 시각, 정확도, 완주 여부, 연주 모드와 가명 식별값을 이용해요. 이름·이메일 등 계정 정보와 약점 요약은 학습에 쓰지 않아요.',
      '3. 처리 방식: 무작위로 만든 가명 식별값으로 연주 기록을 처리해요. 가명 정보는 익명이 아니며 추가 정보를 이용하면 계정과 연결할 수 있어요. 추천 운영 학습 배치는 모델, 입력 파일, 사용자별 학습 벡터를 저장하지 않고 메모리에서 처리해요.',
      '4. 추천 후보: 계정당 최대 50개를 저장해요. 새 후보가 생성된 경우 기존 목록을 교체하며, 생성 후 7일이 지난 후보는 추천에 쓰지 않아요.',
      '5. 동의 철회: 설정에서 언제든 철회할 수 있어요. 철회하면 저장된 후보를 삭제하고 이후 새로 조회하는 학습 데이터에서 해당 사용자의 기록을 제외해요. 철회 전에 이미 시작된 배치는 읽어 둔 기록을 메모리에서 처리할 수 있어요. 배치는 매번 새로 학습하며 학습 모델과 사용자별 벡터는 저장하지 않고, 철회한 기록은 다음 학습부터 반영되지 않아요. 다시 동의하면 새 가명 식별값을 만들며, 서비스에 보관 중인 과거 연주 기록도 위 이용 항목의 범위에서 다시 학습에 사용할 수 있어요.',
      '6. 동의하지 않거나 철회해도 곡 추천을 포함한 서비스를 이용할 수 있어요. 맞춤 모델 추천 대신 기본 추천을 제공해요.',
    ].join('\n'),
  },
];

/** 약관 항목 하나의 판. 항목이 없으면 빈 문자열 */
export function termVersion(id: SignupTermId, terms: readonly SignupTerm[] = SIGNUP_TERMS): string {
  return terms.find((t) => t.id === id)?.version ?? '';
}

/** 현재 약관 판을 BE 저장 본문 모양으로 묶는다. 추천 학습 활용은 체크 집합에 `recommendation`이 있는지를 agreed로 싣는다(설계 D3) */
export function currentConsentVersions(
  terms: readonly SignupTerm[] = SIGNUP_TERMS,
  agreed: ReadonlySet<SignupTermId> = new Set(),
): ConsentVersions {
  return {
    termsVersion: termVersion('terms', terms),
    privacyVersion: termVersion('privacy', terms),
    dataConsent: { agreed: true, version: termVersion('dataConsent', terms) },
    ...(terms.some((t) => t.id === 'recommendation') ? { recommendationConsent: { agreed: agreed.has('recommendation'), version: termVersion('recommendation', terms) } } : {}),
  };
}

/** 연주 기록 활용 항목의 판. 없으면 빈 문자열. 설정 토글·업로드 동의 판단이 이 판 하나만 쓴다(설계 D13) */
export function dataConsentVersion(terms: readonly SignupTerm[] = SIGNUP_TERMS): string {
  return termVersion('dataConsent', terms);
}

/** 맞춤 곡 추천 학습 활용 항목의 판. 없으면 빈 문자열. 설정 토글·PUT·안내 모달이 이 판 하나만 쓴다 */
export function recommendationVersion(terms: readonly SignupTerm[] = SIGNUP_TERMS): string {
  return termVersion('recommendation', terms);
}

/** 필수 항목이 전부 동의됐는가 — [동의하고 시작하기] 활성 조건 */
export function allRequiredAgreed(agreed: ReadonlySet<SignupTermId>, terms: readonly SignupTerm[] = SIGNUP_TERMS): boolean {
  return terms.every((t) => !t.required || agreed.has(t.id));
}

/** 필수 항목이 전부 동의됐는가 — 「필수 항목에 모두 동의합니다」 체크 표시. 선택 항목은 보지 않는다(설계 D2) */
export function allAgreed(agreed: ReadonlySet<SignupTermId>, terms: readonly SignupTerm[] = SIGNUP_TERMS): boolean {
  const required = terms.filter((t) => t.required);
  return required.length > 0 && required.every((t) => agreed.has(t.id));
}

/** 「필수 항목에 모두 동의」 클릭: 필수가 전부 켜져 있으면 필수만 끄고, 아니면 필수를 켠다. 선택 항목 상태는 그대로 둔 새 집합을 돌려준다 */
export function toggleAll(agreed: ReadonlySet<SignupTermId>, terms: readonly SignupTerm[] = SIGNUP_TERMS): Set<SignupTermId> {
  const next = new Set(agreed);
  const allOn = allAgreed(agreed, terms);
  for (const t of terms) {
    if (!t.required) continue;
    if (allOn) next.delete(t.id);
    else next.add(t.id);
  }
  return next;
}

/** 항목 하나를 넣거나 뺀 새 집합 */
export function toggleOne(agreed: ReadonlySet<SignupTermId>, id: SignupTermId): Set<SignupTermId> {
  const next = new Set(agreed);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
