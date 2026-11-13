// 화면 로드·렌더 오류 경계(설계 TECH-chunk-load-recovery D4~D6).
// 청크 로드 실패면 1회 자동 새로고침을 시도하고, 못 하면 "새 버전" 안내. 그 밖의 오류는 일반 안내(자동 새로고침 없음).
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { useRouteError } from 'react-router-dom';
import { isChunkLoadError, tryAutoReload } from '@/config/chunkRecovery';
import { useRecordingStore } from '@/runtime/recordingStore';
import { ErrorState } from '@/components/ui/feedback/ErrorState';
import './RouteErrorBoundary.css';

/** 녹음 중·저장 대기 중이면 자동 새로고침을 하지 않는다(D7) */
function isBusy(): boolean {
  return useRecordingStore.getState().phase !== 'idle';
}

function reloadPage(): void {
  window.location.reload();
}

/** pending: 청크 오류의 자동 새로고침 결정 전(아무것도 그리지 않는다), reloading: 새로고침 중 */
type Mode = 'pending' | 'reloading' | 'chunk' | 'general';

function Notice({ mode }: { mode: 'chunk' | 'general' }) {
  const chunk = mode === 'chunk';
  return (
    <ErrorState
      className="route-error"
      headingLevel={2}
      size="lg"
      title={chunk ? '새 버전이 있어요' : '화면을 불러오지 못했어요'}
      description={chunk ? '새로고침하면 이어서 쓸 수 있어요.' : '새로고침해 주세요. 계속되면 알려 주세요.'}
      onRetry={reloadPage}
      retryLabel="새로고침"
    />
  );
}

function renderMode(mode: Mode): ReactNode {
  return mode === 'chunk' || mode === 'general' ? <Notice mode={mode} /> : null;
}

interface Props {
  /** 바뀌면 오류 상태를 지운다(경로가 바뀌면 정상 화면으로) */
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: unknown;
  hasError: boolean;
  mode: Mode;
  /** 오류가 난 시점의 resetKey. props.resetKey와 달라지면 오류를 푼다 */
  key: string;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null, hasError: false, mode: 'general', key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error, hasError: true, mode: isChunkLoadError(error) ? 'pending' : 'general' };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.key) return null;
    return { error: null, hasError: false, mode: 'general', key: props.resetKey };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (isChunkLoadError(error)) {
      const result = tryAutoReload(window.location.pathname, { busy: isBusy() });
      this.setState({ mode: result === 'reloading' ? 'reloading' : 'chunk' });
    } else {
      console.error(error, info.componentStack);
    }
  }

  render(): ReactNode {
    return this.state.hasError ? renderMode(this.state.mode) : this.props.children;
  }
}

/** 라우트 최상위 errorElement — 셸 밖 오류도 기본 오류 화면 대신 같은 안내를 전체 화면으로 그린다 */
export function RouteErrorElement() {
  const error = useRouteError();
  const chunk = isChunkLoadError(error);
  const [mode, setMode] = useState<Mode>(chunk ? 'pending' : 'general');
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current) return; // StrictMode의 이중 실행에서 가드에 스스로 걸리지 않게 한다
    decided.current = true;
    if (chunk) {
      setMode(tryAutoReload(window.location.pathname, { busy: isBusy() }) === 'reloading' ? 'reloading' : 'chunk');
    } else {
      console.error(error);
    }
  }, [chunk, error]);

  return <div className="route-error-page">{renderMode(mode)}</div>;
}
