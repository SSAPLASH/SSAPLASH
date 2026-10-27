// 약점 분석·추천 연습 자리. 실제 내용은 AI 분석(158 이후 상태 전환)이 오면 채운다
import type { AnalysisStatus } from '@/domain/report';

const TEXT: Record<AnalysisStatus, string> = {
  NOT_REQUESTED: 'AI 약점 분석은 준비 중입니다.',
  PENDING: 'AI가 연주를 분석하고 있습니다. 잠시 뒤 다시 확인해 주세요.',
  DONE: 'AI 분석이 끝났습니다. 결과 표시는 곧 추가됩니다.',
  FAILED: '이번 연주의 AI 분석을 만들지 못했습니다.',
};

export function AnalysisPlaceholder({ status }: { status: AnalysisStatus }) {
  return (
    <div className="card col">
      <h3>약점 구간 · 추천 연습</h3>
      <p className={status === 'FAILED' ? 'notice error' : 'notice'}>{TEXT[status] ?? TEXT.NOT_REQUESTED}</p>
    </div>
  );
}
