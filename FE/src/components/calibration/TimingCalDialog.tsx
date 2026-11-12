// 박자 맞추기 대화상자(설계 PLAY-004-timing-offset-calibration 4-1). 안내 → 클릭 16박 진행 → 결과.
// 진행·계산은 runtime/timingCalSession이 하고, 여기서는 스냅샷을 그리고 적용을 누르면 설정에 저장한다.
// TimingCalView는 props만 받는 표시부(정적 렌더 테스트용), TimingCalDialog가 세션·설정을 잇는다.
import { useEffect, useId, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { timingCalSession, TIMING_CAL_TOTAL_BEATS, type TimingCalSnapshot } from '@/runtime/timingCalSession';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { TIMING_CAL_LISTEN_BEATS, TIMING_CAL_MEASURE_BEATS } from '@/domain/kit/timingCalibration';
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
}

export function TimingCalView({ snap, currentOffsetMs, titleId, onStart, onApply, onClose }: ViewProps) {
  const { phase, result } = snap;
  const running = phase === 'listen' || phase === 'measure';
  const warn = phase === 'result' ? outputLatencyWarnText(snap.outputLatencyMs) : null;
  return (
    <>
      <h2 id={titleId}>박자 맞추기</h2>

      {(phase === 'idle' || phase === 'starting') && (
        <>
          <p className="timing-cal-text">
            클릭 소리에 맞춰 아무 패드나 쳐 주세요. 처음 {TIMING_CAL_LISTEN_BEATS}번은 듣기만 하고, 이어지는 {TIMING_CAL_MEASURE_BEATS}번을 맞춰 치면 돼요.
          </p>
          <p className="timing-cal-sub">내 드럼 소리가 클릭과 겹쳐 들리게 치세요. 그 타이밍에 판정을 맞춰요.</p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              닫기
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
            {phase === 'listen' ? '듣기만 하세요' : '클릭에 맞춰 치세요'}
          </p>
          <div className="timing-cal-beats" aria-hidden="true">
            {Array.from({ length: TIMING_CAL_TOTAL_BEATS }, (_, i) => (
              <span
                key={i}
                className={`timing-cal-beat${i < TIMING_CAL_LISTEN_BEATS ? ' listen' : ''}${i < snap.beat ? ' on' : ''}${i === snap.beat - 1 ? ' now' : ''}`}
              />
            ))}
          </div>
          <p className="timing-cal-sub">
            받은 타격 {Math.min(snap.taps, TIMING_CAL_MEASURE_BEATS)} / {TIMING_CAL_MEASURE_BEATS}
          </p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              취소
            </Button>
          </div>
        </>
      )}

      {phase === 'result' && result && (
        <>
          <p className="timing-cal-text" role="status">
            {timingCalResultText(result)}
          </p>
          {result.status === 'ok' && result.offsetMs !== null && (
            <p className="timing-cal-change">
              판정 타이밍 보정 <span className="timing-cal-old">{timingOffsetText(currentOffsetMs)}</span> →{' '}
              <strong>{timingOffsetText(result.offsetMs)}</strong>
            </p>
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

export function TimingCalDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const snap = useSyncExternalStore(timingCalSession.subscribe, timingCalSession.snapshot);
  const currentOffsetMs = useSettings((s) => s.audioOffsetMs);

  // 설정·드럼 세팅 화면은 키보드 타격을 받지 않는다. 측정하는 동안만 켜서 키보드로도 맞출 수 있게 한다
  useKeyboardDrum(snap.phase === 'listen' || snap.phase === 'measure');

  // 닫히거나 화면을 떠나면 측정을 멈춘다(예약 중단, 타격 가로채기 해제)
  useEffect(() => () => timingCalSession.cancel(), []);

  const onApply = () => {
    const r = snap.result;
    if (r && r.status === 'ok' && r.offsetMs !== null && r.medianMs !== null && r.madMs !== null && r.input !== null) {
      const st = useSettings.getState();
      st.setAudioOffsetMs(r.offsetMs);
      st.setTimingCal({
        measuredAt: Date.now(),
        medianMs: r.medianMs,
        madMs: r.madMs,
        pairs: r.pairs,
        input: r.input,
        outputLatencyMs: snap.outputLatencyMs,
      });
    }
    onClose();
  };

  return (
    <Dialog labelledBy={titleId} onClose={onClose} className="timing-cal-dialog">
      <TimingCalView
        snap={snap}
        currentOffsetMs={currentOffsetMs}
        titleId={titleId}
        onStart={() => void timingCalSession.start()}
        onApply={onApply}
        onClose={onClose}
      />
    </Dialog>
  );
}
