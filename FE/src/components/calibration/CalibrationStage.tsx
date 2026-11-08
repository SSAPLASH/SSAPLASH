// 보정·재정렬 본문(PLAY-004 4-1·4-2, UX-64, Figma 보정 무대 766:34637). 보정 중(드럼 배치 카드 안): 킷 위에 큰 안내 「하이햇을 2번 타격하세요」(40px),
// 킷 전체는 어둡게(0.18) 두고 지금 칠 패드만 원래 밝기 + 글로우. 연결된 손마다 2타를 채우면 그 패드가 실제 친 위치로 옮겨진다. 오른쪽은 CapturePanel([다시][다음|저장]).
// 재정렬 중(② 카드): 스네어 유령 + RealignPrompt. 계산·전송은 하지 않는다: liveStore.calibration 스냅샷을 읽고 calibrationSession 액션만 부른다.
import { useEffect, useRef, useState } from 'react';
import { DrumKit } from '@/components/drum/DrumKit';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { Button } from '@/components/ui/Button';
import { RealignPrompt } from './RealignPrompt';
import { CapturePanel } from './CapturePanel';
import { captureHeadline, spreadWarningText } from './calibrationText';
import { calibrationSession } from '@/app/calibrationSession';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import type { CaptureSnapshot } from '@/engine/HitCapture';
import { anchorsToLayout } from '@/domain/kitJudge';
import type { KitLayout } from '@/domain/kitLayout';
import { DEFAULT_KIT_LAYOUT } from '@/domain/kitLayout';
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
  /** 마지막 패드의 [저장](UX-64): 세션을 끝내고(active) 또는 초안을 받아(new) 저장 흐름을 연다. 호출자가 next→finish를 한다 */
  onSave?: () => void;
}

export function CalibrationStage({ onRestart, onSave }: CalibrationStageProps) {
  const cal = useLive((l) => l.calibration);
  const kitSkin = useSettings((s) => s.kitSkin);
  const tuning = useSettings((s) => s.tuning);
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
  // 킷 전체를 어둡게 두고 지금 칠 패드만 켠다(Figma 766:34637). 끝난 패드는 실제 친 위치로 옮기고,
  // 세션 밖 패드(패드 단위 재보정의 나머지)는 현재 배치 자리. 새 프리셋(추가하기)은 기본 배치를 바탕으로 놓는다
  const base = cal.target === 'new' ? DEFAULT_KIT_LAYOUT : kitLayout;
  const placement = placementOf(cap, base, tuning.angleRange);
  const onPadClick = (pad: PadId) => {
    if (completed.includes(pad)) calibrationSession.redo(pad);
  };

  return (
    <div className="cal-stage" data-testid="cal-stage-capture">
      <div className="cal-stage-main">
        <div className="cal-stage-kit">
          {cap.target && <p className="cal-stage-headline">{captureHeadline(cap.target, cap.hands)}</p>}
          <DrumKit fitWidth skin={kitSkin} states={padStates} hitSeq={hitSeq} placement={placement} dimAll lit={cap.target ?? undefined} onPadClick={onPadClick} />
        </div>
        <CapturePanel
          cap={cap}
          tuning={tuning}
          onRedo={() => cap.target && calibrationSession.redo(cap.target)}
          onNext={() => calibrationSession.next()}
          onSave={() => onSave?.()}
          onRadius={(pad, deg) => calibrationSession.setRadiusOverride(pad, deg)}
        />
      </div>
      <span className="cal-stage-progress" aria-label={`${completed.length} / ${cap.order.length} 패드 완료`}>
        {cap.order.map((pad) => (
          <span key={pad} className={`cal-stage-dot ${completed.includes(pad) ? 'done' : pad === cap.target ? 'now' : ''}`} title={PAD_META[pad].label} />
        ))}
      </span>
      {cap.warning && <p className="cal-stage-warn">{spreadWarningText(cap.warning)}</p>}
      {weak && !cap.warning && <p className="cal-stage-hint">조금 세게 쳐 보세요</p>}
      <p className="cal-stage-hint">불이 들어온 패드를 2번 쳐요. 값이 맞으면 [다음], 다시 치려면 [다시]를 눌러요. 끝난 드럼을 누르면 그 드럼만 다시 칠 수 있어요.</p>
    </div>
  );
}
