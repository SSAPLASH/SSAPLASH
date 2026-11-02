// 가입 동의 화면 (설계 COACH-003-signup-consent). 로그인 화면과 같은 2분할(좌 브랜드·우 카드), PublicLayout 아래.
// 1단계(화면만): 제출하면 자유 연습으로 간다. 2단계가 이 자리에 동의 저장(POST)과 신규 회원 분기를 넣는다.
import { useNavigate } from 'react-router-dom';
import { AuthBrandPane } from '@/components/auth/AuthBrandPane';
import { SignupConsentCard } from '@/components/auth/SignupConsentCard';

export function SignupPage() {
  const navigate = useNavigate();
  return (
    <div className="login">
      <AuthBrandPane />
      <SignupConsentCard onSubmit={() => navigate('/', { replace: true })} />
    </div>
  );
}
