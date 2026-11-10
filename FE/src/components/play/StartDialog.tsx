// 시작 확인 창 (설계 MODE-001-MODE-003-picker-quick-start, Figma 905:4457 `Play / StartDialog`).
// 곡 카드의 [플레이]를 누르면 항상 이 창이 열린다. 준비 조건에 따라 두 변형 중 하나:
//  - play: 곡 한 줄 요약 · 연주 옵션 · 안내 · [취소] [▶ 플레이]. Enter = 플레이(불러오는 중·오류에는 막음)
//  - setup: 「기기 준비가 필요해요」 · 빠진 항목 · [취소] [다시 연결] [드럼 세팅으로]. 플레이 버튼 없음
// props만 받는다 — 스토어 구독·준비 조건 계산·이동은 페이지가 한다. 초점 가둠·Esc는 ui/Dialog(useDialogFocus)가 맡는다.
import { useEffect, useRef, type ReactNode } from 'react';
import type { Difficulty } from '@/domain/chart';
import type { ReadinessMissing } from '@/domain/readiness';
import { artistLabel } from '@/domain/songCatalog';
import { RealignPrompt, type RealignInfo } from '@/components/calibration/RealignPrompt';
import { formatDuration } from '@/components/formatTime';
import { LevelBadge } from '@/components/song/LevelBadge';
import { PlayIcon } from '@/components/studio/StudioIcons';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { DeviceCheck } from './DeviceCheck';
import './start-dialog.css';

export interface StartDialogProps {
  open: boolean;
  variant: 'play' | 'setup';
  song: { title: string; artist: string; bpm: number; durationSec?: number; level: Difficulty };
  /** 요약 줄 앞머리: 「악보 연습」·「리듬 게임」 */
  modeLabel: string;
  /** setup 창 내용(ReadyPanel과 같은 의미) */
  missing: ReadinessMissing[];
  connected: [boolean, boolean];
  keyboardOnly?: boolean;
  pedal?: boolean;
  presetName?: string | null;
  /** play 창의 옵션 칸(PlayOptions) */
  options?: ReactNode;
  /** 안내 문구(재정렬·변박 등). 줄마다 하나 */
  notices?: string[];
  /** 스네어 재정렬이 걸려 있으면 안내 줄에 프롬프트를 보인다(시작을 막지 않음) */
  realign?: RealignInfo | null;
  /** 채보를 불러오는 중이면 ▶ 플레이 자리에 스피너 */
  loading?: boolean;
  /** 채보·반주를 불러오지 못했을 때의 문구. 있으면 [다시 시도] */
  error?: string | null;
  /** 카운트다운 켬(1)·끔(0). 안내 문구용 */
  countInBars: number;
  onStart: () => void;
  onSetup: () => void;
  /** 있을 때만 [다시 연결]을 보인다(setup 창) */
  onReconnect?: () => void;
  onRetry?: () => void;
  onClose: () => void;
}

export function StartDialog({
  open,
  variant,
  song,
  modeLabel,
  missing,
  connected,
  keyboardOnly = false,
  pedal,
  presetName = null,
  options,
  notices = [],
  realign,
  loading = false,
  error = null,
  countInBars,
  onStart,
  onSetup,
  onReconnect,
  onRetry,
  onClose,
}: StartDialogProps) {
  const startRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const canStart = variant === 'play' && !loading && !error;

  // Enter = 플레이. 버튼에 초점이 있으면 그 버튼의 기본 클릭에 맡기고, 그 밖(체크 줄·창·body)에서만 처리한다
  const startRefFn = useRef(onStart);
  useEffect(() => {
    startRefFn.current = onStart;
  }, [onStart]);
  useEffect(() => {
    if (!open || !canStart) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented || e.repeat) return;
      if ((e.target as HTMLElement | null)?.closest?.('button, a[href]')) return;
      e.preventDefault();
      startRefFn.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, canStart]);

  // 창이 열린 동안 setup → play로 바뀌면(기기가 이어짐) 초점을 ▶ 플레이로 옮긴다
  useEffect(() => {
    if (canStart && document.activeElement === cancelRef.current) startRef.current?.focus();
  }, [canStart]);

  if (!open) return null;

  const meta = [modeLabel, `BPM ${Math.round(song.bpm)}`];
  if (song.durationSec !== undefined) meta.push(formatDuration(song.durationSec * 1000));
  const isPlay = variant === 'play';
  const title = isPlay ? song.title : '기기 준비가 필요해요';
  const guide = isPlay
    ? countInBars > 0
      ? '시작하면 5초 카운트다운과 준비 1마디 뒤 노트가 시작돼요.'
      : '시작하면 바로 노트가 시작돼요.'
    : '스틱·페달 연결과 첫 보정이 끝나면 플레이할 수 있어요.';

  return (
    <Dialog
      className={`start-dialog start-dialog-${variant}`}
      labelledBy="start-dialog-title"
      initialFocusRef={isPlay && canStart ? startRef : cancelRef}
      onClose={onClose}
    >
      <header className="start-dialog-head">
        <h2 id="start-dialog-title" className="start-dialog-title">
          {title}
        </h2>
        <p className="start-dialog-song">
          <LevelBadge level={song.level} size="sm" />
          <span>{isPlay ? meta.join(' · ') : `${song.title} · ${artistLabel(song.artist)}`}</span>
        </p>
      </header>

      {isPlay ? (
        <>
          <section className="start-dialog-section" aria-label="연주 옵션">
            <h3 className="start-dialog-caption">연주 옵션</h3>
            {options}
          </section>
          {notices.map((n) => (
            <p key={n} className="start-dialog-notice" role="status">
              {n}
            </p>
          ))}
          {realign && <RealignPrompt hands={realign.hands} done={realign.done} variant="row" onSkip={realign.onSkip} />}
        </>
      ) : (
        <DeviceCheck
          ready={false}
          missing={missing}
          connected={connected}
          keyboardOnly={keyboardOnly}
          pedal={pedal}
          presetName={presetName}
          hideHead
          hideActions
          hidePreset
        />
      )}

      {error ? (
        <p className="start-dialog-error" role="alert">
          {error}
        </p>
      ) : (
        <p className={`start-dialog-guide${isPlay ? '' : ' need'}`}>{guide}</p>
      )}

      <div className="start-dialog-actions">
        <Button variant="secondary" ref={cancelRef} onClick={onClose}>
          취소
        </Button>
        {isPlay ? (
          error ? (
            <Button onClick={onRetry} disabled={!onRetry}>
              다시 시도
            </Button>
          ) : loading ? (
            <Button disabled>
              <span className="spinner" role="status" aria-label="불러오는 중" />
            </Button>
          ) : (
            <Button ref={startRef} leadingIcon={<PlayIcon size={16} />} onClick={onStart}>
              플레이
            </Button>
          )
        ) : (
          <>
            {onReconnect && (
              <Button variant="secondary" onClick={onReconnect}>
                다시 연결
              </Button>
            )}
            <Button onClick={onSetup}>드럼 세팅으로</Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
