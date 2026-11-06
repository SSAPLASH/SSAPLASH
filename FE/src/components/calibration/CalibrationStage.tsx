// 세팅 ② 단계 본문(PLAY-004 4-1·4-2). 보정 중에는 빈 킷 위에 목표 패드가 유령으로 깜빡이고,
// 연결된 손마다 2타를 채우면 그 패드가 실제 친 위치에 나타난다. 재정렬 중에는 스네어 유령 + RealignPrompt.
// 계산·전송은 하지 않는다: liveStore.calibration 스냅샷을 읽고 calibrationSession 액션만 부른다.
import { useEffect, useRef, useState } from 'react';
import { DrumKit } from '@/components/drum/DrumKit';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { Button } from '@/components/ui/Button';
import { RealignPrompt } from './RealignPrompt';
import { captureLine, HAND_NAME, spreadWarningText } from './calibrationText';
import { calibrationSession } from '@/app/calibrationSession';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import type { CaptureSnapshot } from '@/engine/HitCapture';
import { anchorsToLayout } from '@/domain/kitJudge';
import type { KitLayout } from '@/domain/kitLayout';
import { layoutToKitPoint } from '@/domain/drumKit';
import { PAD_META, STICK_PADS, type PadId } from '@/domain/pads';
import { angleBetween, type HandAnchors } from '@/domain/calibration';
import type { Pose } from '@/domain/events';
import './calibration.css';

/** 마지막 수락 타격 뒤 이만큼(ms) 타격이 없고 스틱은 움직이면 "조금 세게" 안내 */
const WEAK_HINT_MS = 2000;
/** 스틱이 "움직이고 있다"고 볼 자세 변화(도/0.5초) */
const MOVING_DEG = 3;

/** 끝난 패드(대상 손 전부가 채운 패드) */
function completedOf(cap: CaptureSnapshot): PadId[] {
  return cap.order.filter((pad) => cap.hands.length > 0 && cap.hands.every((h) => cap.captured[pad]?.[h] !== undefined));
}

/**
 * 패드 위치: 이번 세션에 없는 패드(패드 단위 재보정 때 나머지)는 현재 배치 자리, 끝난 패드는 실제 친 위치(앵커 평균 방향),
 * 목표 패드(유령)는 현재 배치 자리
 */
function placementOf(cap: CaptureSnapshot, layout: KitLayout, angleRange: { yawDeg: number; pitchDeg: number }): Partial<Record<PadId, { x: number; y: number }>> {
  const hands: HandAnchors = [{}, {}];
  for (const pad of cap.order) {
    const slot = cap.captured[pad];
    if (!slot) continue;
    for (const h of [0, 1] as const) {
      const a = slot[h];
      if (a) hands[h]![pad] = a;
    }
  }
  const derived = anchorsToLayout(hands, layout, angleRange);
  const completed = completedOf(cap);
  const out: Partial<Record<PadId, { x: number; y: number }>> = {};
  for (const pad of STICK_PADS) out[pad] = layoutToKitPoint(completed.includes(pad) ? derived[pad] : layout[pad]);
  return out;
}

/** 스틱이 움직이는데 타격이 안 들어오는지(약한 타격 안내용) */
function useWeakHint(cap: CaptureSnapshot | null): boolean {
  const [hint, setHint] = useState(false);
  const startAt = useRef<number | null>(null);
  const lastPose = useRef<[Pose, Pose] | null>(null);
  useEffect(() => {
    startAt.current = performance.now();
    lastPose.current = useLive.getState().pose;
    const id = window.setInterval(() => {
      const c = useLive.getState().calibration.capture;
      if (!c || c.phase !== 'capturing') {
        setHint(false);
        return;
      }
      const pose = useLive.getState().pose;
      const prev = lastPose.current ?? pose;
      const moved = ([0, 1] as const).some((i) => angleBetween(pose[i], prev[i]) >= MOVING_DEG);
      lastPose.current = pose;
      const since = performance.now() - (c.lastAccepted?.at ?? startAt.current ?? performance.now());
      setHint(moved && since > WEAK_HINT_MS);
    }, 500);
    return () => window.clearInterval(id);
  }, []);
  return cap !== null && hint;
}

export interface CalibrationStageProps {
  /** 재정렬 중 [처음부터 보정] 버튼. 없으면 버튼을 그리지 않는다 */
  onRestart?: () => void;
}

export function CalibrationStage({ onRestart }: CalibrationStageProps) {
  const cal = useLive((l) => l.calibration);
  const kitSkin = useSettings((s) => s.kitSkin);
  const angleRange = useSettings((s) => s.tuning.angleRange);
  const kitLayout = useSettings((s) => s.kitLayout);
  const padStates = usePadStates();
  const hitSeq = usePadHitSeq();
  const weak = useWeakHint(cal.capture);

  if (cal.mode === 'realign' && cal.realign) {
    return (
      <div className="cal-stage" data-testid="cal-stage-realign">
        <div className="cal-stage-kit">
          <DrumKit fitWidth skin={kitSkin} states={padStates} hitSeq={hitSeq} ghost="SNARE" />
        </div>
        <RealignPrompt hands={cal.realign.hands} done={cal.realign.done} variant="card" onSkip={() => calibrationSession.skipRealign()} />
        {onRestart && (
          <div className="setup-row">
            <Button variant="secondary" size="sm" onClick={onRestart}>
              처음부터 보정
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (cal.mode !== 'capture' || !cal.capture) return null;
  const cap = cal.capture;
  const completed = completedOf(cap);
  // 이번 세션 패드 중 아직 안 잡은 것만 숨긴다. 세션 밖 패드(패드 단위 재보정의 나머지)는 그대로 보인다
  const hidden = cap.order.filter((p) => !completed.includes(p) && p !== cap.target);
  const placement = placementOf(cap, kitLayout, angleRange);
  const onPadClick = (pad: PadId) => {
    if (completed.includes(pad)) calibrationSession.redo(pad);
  };

  return (
    <div className="cal-stage" data-testid="cal-stage-capture">
      <div className="cal-stage-kit">
        <DrumKit
          fitWidth
          skin={kitSkin}
          states={padStates}
          hitSeq={hitSeq}
          hidden={hidden}
          ghost={cap.target ?? undefined}
          placement={placement}
          faded={['KICK']}
          appear
          onPadClick={onPadClick}
        />
      </div>
      {cap.target && (
        <div className="cal-stage-line">
          <span className="cal-stage-target">{captureLine(cap.target, cap.hands)}</span>
          <span className="cal-stage-counts" aria-label="손별 타격 수">
            {cap.hands.map((h) => (
              <span key={h} className={cap.counts[h] >= 2 ? 'full' : undefined}>
                {HAND_NAME[h]} {cap.counts[h]}/2
              </span>
            ))}
          </span>
        </div>
      )}
      <span className="cal-stage-progress" aria-label={`${completed.length} / ${cap.order.length} 패드 완료`}>
        {cap.order.map((pad) => (
          <span key={pad} className={`cal-stage-dot ${completed.includes(pad) ? 'done' : pad === cap.target ? 'now' : ''}`} title={PAD_META[pad].label} />
        ))}
      </span>
      {cap.warning && <p className="cal-stage-warn">{spreadWarningText(cap.warning)}</p>}
      {weak && !cap.warning && <p className="cal-stage-hint">조금 세게 쳐 보세요</p>}
      <p className="cal-stage-hint">끝난 드럼을 누르면 그 드럼만 다시 칠 수 있어요. 소리는 지금 치라고 한 드럼으로 나요.</p>
      <div className="setup-row">
        <Button variant="secondary" size="sm" onClick={() => calibrationSession.cancelCapture()}>
          취소
        </Button>
      </div>
    </div>
  );
}
