// 박자 맞추기 대화상자(설계 PLAY-004-timing-offset-calibration 4-1, PLAY-004-timing-cal-stick-kick). 안내 → 클릭 16박(킥 연결 시 32박) 진행 → 결과.
// 진행·계산은 runtime/timingCalSession이 하고, 여기서는 스냅샷을 그리고 적용을 누르면 설정에 저장한다.
// TimingCalView는 props만 받는 표시부(정적 렌더 테스트용), TimingCalDialog가 세션·설정을 잇는다.
import { useEffect, useId, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { timingCalSession, type TimingCalSnapshot } from '@/runtime/timingCalSession';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import {
  timingCalApply,
  TIMING_CAL_LISTEN_BEATS,
  TIMING_CAL_MEASURE_BEATS,
  TIMING_CAL_RECHECK_DIFF_MS,
  TIMING_CAL_SWITCH_BEATS,
} from '@/domain/kit/calibration/timingCalibration';
import { useSettings } from '@/store/settingsStore';
import { outputLatencyWarnText, timingCalResultText, timingOffsetText } from './timingCalText';
import './timingCal.css';

interface ViewProps {
  snap: TimingCalSnapshot;
  /** 지금 설정의 판정 타이밍 보정(ms) */
  currentOffsetMs: number;
  titleId: string;
  onStart: () => void;
  onApply: () => void;
  onClose: () => void;
  /** 첫 연주 전 권유로 띄운 경우: 안내 한 줄을 더하고 닫기 버튼을 [나중에 하기]로 쓴다 */
  intro?: boolean;
}

/** 스틱 구간이 끝나는 박 번호(0부터). 킥 구간을 그릴 때 박 점의 시작점 */
const STICK_END = TIMING_CAL_LISTEN_BEATS + TIMING_CAL_MEASURE_BEATS;
/** 구간별 안내 문구. 킥이 없는 측정의 측정 박은 아무 패드나 치므로 문구를 따로 쓴다 */
const PHASE_TEXT: Record<'listen' | 'measure' | 'switch' | 'kick', string> = {
  listen: '듣기만 하세요',
  measure: '스틱으로 박에 맞춰 치세요',
  switch: '이제 킥 페달로 바꿔요',
  kick: '킥 페달로 박에 맞춰 밟으세요',
};

export function TimingCalView({ snap, currentOffsetMs, titleId, onStart, onApply, onClose, intro = false }: ViewProps) {
  const { phase, outcome } = snap;
  const result = outcome?.stick ?? null;
  const kickResult = outcome?.kick ?? null;
  const running = phase === 'listen' || phase === 'measure' || phase === 'switch' || phase === 'kick';
  const inKickHalf = phase === 'switch' || phase === 'kick';
  // 박 점은 한 줄에 16개까지. 킥 구간(전환 박 포함)에 들어서면 그 구간의 박만 보인다
  const dotOffset = inKickHalf ? STICK_END : 0;
  const dotCount = inKickHalf ? snap.totalBeats - STICK_END : STICK_END;
  const warn = phase === 'result' ? outputLatencyWarnText(snap.outputLatencyMs) : null;
  return (
    <>
      <h2 id={titleId}>박자 맞추기</h2>

      {(phase === 'idle' || phase === 'starting') && (
        <>
          {intro && <p className="timing-cal-sub">처음 한 번만 박자를 맞추면 판정이 정확해져요.</p>}
          <p className="timing-cal-text">
            클릭 소리에 맞춰 아무 패드나 쳐 주세요.
            <br />
            처음 {TIMING_CAL_LISTEN_BEATS}번은 듣기만 하고, 이어지는 {TIMING_CAL_MEASURE_BEATS}번을 맞춰 치면 돼요.
          </p>
          <p className="timing-cal-sub">내 드럼 소리가 클릭과 겹쳐 들리게 치세요. 그 타이밍에 판정을 맞춰요.</p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              {intro ? '나중에 하기' : '닫기'}
            </Button>
            <Button onClick={onStart} disabled={phase === 'starting'}>
              시작
            </Button>
          </div>
        </>
      )}

      {running && (
        <>
          <p className="timing-cal-text" role="status">
            {phase === 'measure' && !snap.withKick ? '클릭에 맞춰 치세요' : PHASE_TEXT[phase]}
          </p>
          <div className="timing-cal-beats" aria-hidden="true">
            {Array.from({ length: dotCount }, (_, k) => {
              const i = dotOffset + k;
              // 듣기 박과 전환 박은 짝짓지 않으므로 작게 그린다
              const quiet = i < TIMING_CAL_LISTEN_BEATS || (i >= STICK_END && i < STICK_END + TIMING_CAL_SWITCH_BEATS);
              return (
                <span
                  key={i}
                  className={`timing-cal-beat${quiet ? ' listen' : ''}${i < snap.beat ? ' on' : ''}${i === snap.beat - 1 ? ' now' : ''}`}
                />
              );
            })}
          </div>
          {phase !== 'switch' && (
            <p className="timing-cal-sub">
              받은 타격 {Math.min(snap.taps, TIMING_CAL_MEASURE_BEATS)} / {TIMING_CAL_MEASURE_BEATS}
            </p>
          )}
          <div className="dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              취소
            </Button>
          </div>
        </>
      )}

      {phase === 'result' && result && (
        <>
          {outcome?.recheck && (
            <p className="timing-cal-warn">스틱과 킥 값이 {TIMING_CAL_RECHECK_DIFF_MS}ms 넘게 달라요. 한 번 더 재 볼까요?</p>
          )}
          <p className="timing-cal-text" role="status">
            {timingCalResultText(result)}
          </p>
          {result.status === 'ok' && result.offsetMs !== null && (
            <p className="timing-cal-change">
              {kickResult ? '스틱' : '판정 타이밍 보정'} <span className="timing-cal-old">{timingOffsetText(currentOffsetMs)}</span> →{' '}
              <strong>{timingOffsetText(result.offsetMs)}</strong>
            </p>
          )}
          {result.status === 'ok' && kickResult && kickResult.status === 'ok' && kickResult.offsetMs !== null && (
            <p className="timing-cal-change">
              킥 <strong>{timingOffsetText(kickResult.offsetMs)}</strong>
            </p>
          )}
          {result.status === 'ok' && kickResult && kickResult.status !== 'ok' && (
            <p className="timing-cal-sub">킥은 값을 얻지 못했어요. 스틱 값을 같이 써요.</p>
          )}
          {warn && <p className="timing-cal-warn">{warn}</p>}
          <div className="dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              {result.status === 'ok' ? '취소' : '닫기'}
            </Button>
            <Button variant={result.status === 'ok' ? 'secondary' : 'primary'} onClick={onStart}>
              다시 하기
            </Button>
            {result.status === 'ok' && <Button onClick={onApply}>적용</Button>}
          </div>
        </>
      )}
    </>
  );
}

interface DialogProps {
  onClose: () => void;
  /** 첫 연주 전 권유로 띄웠는가(PlayPage·SheetPage의 useTimingCalGate) */
  intro?: boolean;
  /** [적용]으로 값이 저장됐을 때, onClose 전에 부른다 */
  onApplied?: () => void;
  /** 화면별 모양을 덧입힐 클래스(드럼 세팅은 setup-timing-dialog). 기본 모양은 timing-cal-dialog */
  className?: string;
}

export function TimingCalDialog({ onClose, intro = false, onApplied, className }: DialogProps) {
  const titleId = useId();
  const snap = useSyncExternalStore(timingCalSession.subscribe, timingCalSession.snapshot);
  const currentOffsetMs = useSettings((s) => s.audioOffsetMs);

  // 설정·드럼 세팅 화면은 키보드 타격을 받지 않는다. 측정하는 동안만 켜서 키보드로도 맞출 수 있게 한다
  useKeyboardDrum(snap.phase === 'listen' || snap.phase === 'measure' || snap.phase === 'switch' || snap.phase === 'kick');

  // 닫히거나 화면을 떠나면 측정을 멈춘다(예약 중단, 타격 가로채기 해제)
  useEffect(() => () => timingCalSession.cancel(), []);

  const onApply = () => {
    const o = snap.outcome;
    const applied = o ? timingCalApply(o) : null;
    const r = o?.stick;
    if (o && applied && r && r.medianMs !== null && r.madMs !== null && r.input !== null) {
      const k = o.kick;
      const kickOk = applied.kickOffsetMs !== null && k !== null && k.medianMs !== null && k.madMs !== null;
      const st = useSettings.getState();
      st.setAudioOffsetMs(applied.audioOffsetMs);
      st.setKickOffsetMs(applied.kickOffsetMs);
      st.setTimingCal({
        measuredAt: Date.now(),
        medianMs: r.medianMs,
        madMs: r.madMs,
        pairs: r.pairs,
        input: r.input,
        outputLatencyMs: snap.outputLatencyMs,
        kick: kickOk ? { medianMs: k.medianMs!, madMs: k.madMs!, pairs: k.pairs } : null,
      });
      onApplied?.();
    }
    onClose();
  };

  return (
    <Dialog labelledBy={titleId} onClose={onClose} className={`timing-cal-dialog${className ? ` ${className}` : ''}`}>
      <TimingCalView
        snap={snap}
        currentOffsetMs={currentOffsetMs}
        titleId={titleId}
        onStart={() => void timingCalSession.start()}
        onApply={onApply}
        onClose={onClose}
        intro={intro}
      />
    </Dialog>
  );
}
