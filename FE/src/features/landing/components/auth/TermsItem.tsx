// Figma Auth / TermsItem 440:19746 — 머리 줄([체크박스] [필수] 제목) + 높이 96 스크롤 상자. 동의 상태는 부모가 든다.
import { useId } from 'react';
import { Checkbox } from '@/components/ui/form/Checkbox';
import type { SignupTerm } from '@/domain/account/signupTerms';
import './auth.css';

interface Props {
  term: SignupTerm;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function TermsItem({ term, checked, onChange }: Props) {
  const id = useId();
  return (
    <div className="terms-item">
      <Checkbox
        id={`${id}-check`}
        checked={checked}
        onChange={onChange}
        className="terms-item-head"
        label={
          <>
            <span className="terms-item-required t-caption-12">{term.required ? '[필수]' : '[선택]'}</span>
            <span className="terms-item-title">{term.title}</span>
          </>
        }
      />
      {/* 초점을 받으면 방향키로 스크롤된다. 체크박스와 별개로 읽기만 하는 영역 */}
      <div className="terms-item-scroll t-caption-12" role="region" aria-label={`${term.title} 전문`} tabIndex={0}>
        {term.body.split('\n').map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </div>
  );
}
