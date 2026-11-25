// 결과 화면 머리 (Figma 1182:38353). 위 작은 글·「새 최고 기록」·제목 두 줄·[다시 하기]·[미니게임 목록]·오른쪽 점수 칸.
// [다시 하기]는 결과가 뜰 때 포커스를 받는다(키보드로 바로 재도전).
// 「← 미니게임」·[미니게임 목록]은 이 게임을 고른 목록으로 돌아간다(설계 MODE-006-minigame-list-ui D5).
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/action/Button';
import { buttonClassName } from '@/components/ui/action/buttonStyle';
import { miniGameOfPath, miniListPath } from '@/domain/play/miniGame';

interface Props {
  /** 위 작은 글(게임 이름) */
  overline: string;
  /** 위 작은 글 앞의 꼬리표 */
  tag?: { text: string; tone: 'good' | 'bad' };
  newBest: boolean;
  title: readonly [string, string];
  score: { label: string; value: string; unit?: string; note?: string };
  onRetry: () => void;
  /** [다시 하기]와 [미니게임 목록] 사이의 버튼 */
  extraAction?: { label: string; onClick: () => void };
}

export function MiniResultHero({ overline, tag, newBest, title, score, onRetry, extraAction }: Props) {
  const retryRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  // 게임 화면 경로가 아니면(게임 id를 읽지 못하면) 주소 값 없는 목록이다
  const listPath = miniListPath(miniGameOfPath(pathname));

  useEffect(() => {
    retryRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <Link to={listPath} className={`${buttonClassName({ variant: 'text', size: 'sm' })} mini-back`}>
        ← 미니게임
      </Link>
      <div className="mini-result-hero">
        <div className="mini-result-left">
          <div className="mini-result-top">
            {tag ? <span className={`mini-pill mini-pill-${tag.tone}`}>{tag.text}</span> : null}
            {newBest ? <span className="mini-pill mini-pill-new">새 최고 기록</span> : null}
            <span className="mini-overline">{overline}</span>
          </div>
          <h2 className="mini-headline">
            <span>{title[0]}</span>
            <span>{title[1]}</span>
          </h2>
          <div className="mini-result-actions">
            <Button ref={retryRef} onClick={onRetry}>
              다시 하기
            </Button>
            {extraAction ? (
              <Button variant="secondary" onClick={extraAction.onClick}>
                {extraAction.label}
              </Button>
            ) : null}
            <Link to={listPath} className={buttonClassName({ variant: 'secondary' })}>
              미니게임 목록
            </Link>
          </div>
        </div>
        <div className="mini-score">
          <span className="mini-score-label">{score.label}</span>
          <span className="mini-score-value">
            <span>{score.value}</span>
            {score.unit ? <span className="mini-score-unit">{score.unit}</span> : null}
          </span>
          {score.note ? <span className="mini-score-note">{score.note}</span> : null}
        </div>
      </div>
    </>
  );
}
