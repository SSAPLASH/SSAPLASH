// 결과 화면의 [상세 분석 보기] 진입부 (설계 COACH-002 4-1). 업로드 상태에 따라 활성·사유·다시 시도를 보여 준다.
// 상태 구독·재전송은 화면(ResultPage)이 runtime/playSync로 하고 여기는 그리기만 한다.
import { Link } from 'react-router-dom';
import { analysisTeaser, type Report } from '@/domain/play/report';
import type { PlayUploadState } from '@/domain/play/playLog';

/** 업로드하지 않은 사유·실패 코드 → 안내 문구 */
const REASON_TEXT: Record<string, string> = {
  LEGACY_LOG: '이전 버전 기록은 상세 분석을 제공하지 않습니다.',
  BUILTIN_CHART: '연습용 기본 곡은 상세 분석을 제공하지 않습니다.',
  CHART_MISMATCH: '채보 정보가 서버와 달라 분석할 수 없습니다.',
  TOO_LARGE: '기록이 너무 커서 저장하지 못했습니다.',
  FREE_MODE: '자유 연습은 상세 분석을 제공하지 않습니다.',
  NETWORK: '서버에 연결하지 못했습니다.',
  // problem+json이 아닌 응답(게이트웨이·프록시 오류)
  HTTP_ERROR: '서버에 연결하지 못했습니다.',
  UNAUTHORIZED: '로그인이 만료되었습니다. 다시 로그인한 뒤 시도해 주세요.',
  PLAY_UPLOAD_BUSY: '서버가 바쁩니다. 잠시 뒤 다시 시도해 주세요.',
  PLAY_STATE_CHANGED: '저장 중 상태가 바뀌었습니다. 다시 시도해 주세요.',
  PLAY_NOT_FOUND: '곡을 더 이상 찾을 수 없어 기록을 저장하지 못했습니다.',
};

function reasonText(st: PlayUploadState): string {
  return (st.reason && REASON_TEXT[st.reason]) ?? `기록을 저장하지 못했습니다${st.reason ? ` (${st.reason})` : ''}.`;
}

export function ReportEntry({
  playId,
  legacy,
  state: st,
  report,
  onRetry,
}: {
  playId: string;
  /** 이전 형식 로그(UUID 아님) */
  legacy: boolean;
  state: PlayUploadState | undefined;
  /** 프리패치된 리포트. 없거나 로딩 중이면 null */
  report: Report | null;
  onRetry: () => void;
}) {
  const disabled = (text: string) => (
    <div className="report-entry">
      <button className="btn-ghost" disabled>
        상세 분석 보기
      </button>
      <span className="small dim">{text}</span>
    </div>
  );

  if (legacy) return disabled(REASON_TEXT.LEGACY_LOG);
  if (!st || st.status === 'UPLOADING') return disabled('기록 저장 중…');
  if (st.status === 'DONE') {
    return (
      <div className="report-entry">
        <Link to={`/result/${playId}/report`} className="btn-primary">
          상세 분석 보기
        </Link>
        <span className="small dim">{analysisTeaser(report) ?? '패드별 정확도·타이밍·노트 흐름'}</span>
      </div>
    );
  }
  if (st.status === 'FAILED' && st.retryable) {
    return (
      <div className="report-entry">
        <button className="btn-ghost" onClick={onRetry}>
          다시 시도
        </button>
        <span className="small dim">{reasonText(st)} 기록은 이 기기에 남아 있습니다.</span>
      </div>
    );
  }
  return disabled(reasonText(st));
}
