// 시작 전 안내 (Figma 1182:37832). 큰 제목·그림·칸 3개·[시작하기]·스틱 연결 안내 한 줄.
// 「← 미니게임」은 이 게임을 고른 목록으로 돌아간다(설계 MODE-006-minigame-list-ui D5).
// 시작은 막지 않는 것이 기본이다. 게임이 `blocked`를 넘기면 [시작하기]를 끄고 그 사유와 딸린 버튼을 보인다.
import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/action/Button';
import { buttonClassName } from '@/components/ui/action/buttonStyle';
import { miniGameOfPath, miniListPath } from '@/domain/play/miniGame';
import { StatCells, type StatCell } from './StatCells';

interface ActionSpec {
  label: string;
  onClick: () => void;
}

interface Props {
  /** 위 작은 글(게임 이름) */
  overline: string;
  title: readonly [string, string];
  description: string;
  art: ReactNode;
  cells: readonly StatCell[];
  /** 연결돼 있지 않으면 안내 한 줄과 [드럼 세팅]을 보인다(시작은 막지 않는다) */
  stickConnected: boolean;
  /** 시작을 막는 사유. 넘기면 [시작하기]를 끄고 이 문구가 스틱 안내 줄 대신 보인다 */
  blocked?: string;
  /** 사유에 딸린 버튼. 넘기지 않으면 [드럼 세팅], null이면 버튼 없이 문구만 */
  blockedAction?: ActionSpec | null;
  /** [시작하기] 줄에 넣을 게임별 조작 */
  controls?: ReactNode;
  /** 게임별 안내 한 줄(글만, 또는 글과 버튼) */
  note?: string | { text: string; action: ActionSpec };
  /** 참이면 열릴 때 [시작하기]에 포커스를 준다([그만하기]로 돌아왔을 때) */
  focusStart?: boolean;
  onStart: () => void;
}

export function MiniIntro({
  overline,
  title,
  description,
  art,
  cells,
  stickConnected,
  blocked,
  blockedAction,
  controls,
  note,
  focusStart = false,
  onStart,
}: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const startRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusStart) startRef.current?.focus({ preventScroll: true });
  }, [focusStart]);

  const setupButton = (
    <Button variant="secondary" size="sm" onClick={() => navigate('/setup', { state: { returnTo: pathname, returnLabel: '미니게임' } })}>
      드럼 세팅
    </Button>
  );
  const blockedButton =
    blockedAction === undefined ? (
      setupButton
    ) : blockedAction === null ? null : (
      <Button variant="secondary" size="sm" onClick={blockedAction.onClick}>
        {blockedAction.label}
      </Button>
    );

  return (
    <div className="mini-page mini-intro">
      <Link to={miniListPath(miniGameOfPath(pathname))} className={`${buttonClassName({ variant: 'text', size: 'sm' })} mini-back`}>
        ← 미니게임
      </Link>
      <div className="mini-intro-body">
        <div className="mini-intro-hero">
          <div className="mini-intro-text">
            <span className="mini-overline">{overline}</span>
            <h2 className="mini-headline">
              <span>{title[0]}</span>
              <span>{title[1]}</span>
            </h2>
            <p className="mini-lede">{description}</p>
          </div>
          <div className="mini-intro-art">{art}</div>
        </div>
        <StatCells cells={cells} />
        <div className="mini-intro-actions">
          <div className="mini-intro-cta">
            <Button ref={startRef} onClick={onStart} disabled={Boolean(blocked)}>
              시작하기
            </Button>
            {controls}
            {blocked ? (
              <span className="mini-intro-msg">
                <span role="status">{blocked}</span>
                {blockedButton}
              </span>
            ) : !stickConnected ? (
              <span className="mini-intro-msg">
                <span>스틱이 연결돼 있지 않아요</span>
                {setupButton}
              </span>
            ) : null}
          </div>
          {note ? (
            <span className="mini-intro-msg">
              <span>{typeof note === 'string' ? note : note.text}</span>
              {typeof note === 'string' ? null : (
                <Button variant="secondary" size="sm" onClick={note.action.onClick}>
                  {note.action.label}
                </Button>
              )}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
