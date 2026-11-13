// 보정·재정렬 본문(PLAY-004 4-1·4-2, 개편 D2·D3·D6·D10·D11·D14, v0.2). 보정 중(드럼 배치 카드 안): 스테이지 행 전체 폭 판(StagePanel) 안에
// 킷 하나(편집 화면과 같은 원근 틀 + 사용자가 고른 스킨, domain/kit/kitFrame). 판 안 자리: 위쪽 가운데 큰 안내 「하이햇을 2번 타격하세요」·진행 점 / 오른쪽 아래 정보 카드 / 아래쪽 가운데 경고 배너(GapBanner).
// 킷 전체는 어둡게(0.18) 두고 지금 칠 패드만 원래 밝기 + 글로우. 간격 경고는 멈추지 않는다: 진행 중에는 배너([◯◯ 다시])로, 다음 패드를 치면 사라진다.
// 정보 카드 상태: 진행(「하이햇 1/7」+손별 타격 점, 버튼 없음) / 결과(done: 선택 패드 값·반지름·겹침·[다시 치기][저장]).
// 결과 화면에서는 같은 손에서 20° 미만으로 붙은 패드(세션 밖 앵커 base 포함, D14)에 --warn 테두리를 그리고 겹침 요약 배너를 띄우며, 패드를 눌러 고른다(진행 중 클릭은 무동작).
// 재정렬 중(② 카드): 스네어 유령 + RealignPrompt. 계산·전송은 하지 않는다: liveStore.calibration 스냅샷을 읽고 calibrationSession 액션만 부른다.
import { useEffect, useRef, useState } from 'react';
import { DrumKit } from '@/components/drum/DrumKit';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { Button } from '@/components/ui/action/Button';
import { RealignPrompt } from '@/components/calibration/RealignPrompt';
import { KitInfoFrame, KitInfoHead, KitInfoOverlay } from '@/features/setup/components/stage/KitInfoOverlay';
import { StagePanel } from '@/features/setup/components/stage/StagePanel';
import { GapBanner } from './GapBanner';
import { useOverlayRegion } from '@/features/setup/components/stage/useOverlayRegion';
import { HAND_NAME, captureHeadline, overlapLineText, spreadWarningText, wrongHandText } from '@/components/calibration/calibrationText';
import { previewRadius } from './captureRadius';
import { calibrationSession } from '@/runtime/calibrationSession';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { DEFAULT_CAPTURE_OPTIONS, type CaptureSnapshot } from '@/engine/HitCapture';
import { anchorsToLayout } from '@/domain/kit/kitJudge';
import type { KitLayout } from '@/domain/kit/kitLayout';
import { DEFAULT_KIT_LAYOUT, pickOverlayCorner } from '@/domain/kit/kitLayout';
import { kitFrame } from '@/domain/kit/kitFrame';
import { padScreenCircles } from '@/domain/kit/kitPerspective';
import { padPointOf } from '@/domain/kit/kitModel';
import { PAD_META, STICK_PADS, type PadId } from '@/domain/kit/pads';
import { captureHandsFor } from '@/domain/kit/calibration/captureHands';
import { angleBetween, padGaps, type HandAnchors, type HandAnchorSet, type PadAnchor, type PadGap } from '@/domain/kit/calibration/calibration';
import type { Pose, StickId } from '@/domain/events';
import '@/components/calibration/calibration.css';

/** 받을 손이 아닌 손으로 친 뒤 이 시간(ms) 동안 「…는 오른손으로 쳐요」를 보인다 */
const WRONG_HAND_MS = 2000;
/** 마지막 수락 타격 뒤 이만큼(ms) 타격이 없고 스틱은 움직이면 "조금 세게" 안내 */
const WEAK_HINT_MS = 2000;
/** 스틱이 "움직이고 있다"고 볼 자세 변화(도/0.5초) */
const MOVING_DEG = 3;

/** 끝난 패드(그 패드를 받을 손 전부가 채운 패드) */
function completedOf(cap: CaptureSnapshot): PadId[] {
  return cap.order.filter((pad) => cap.hands.length > 0 && captureHandsFor(pad, cap.hands).every((h) => cap.captured[pad]?.[h] !== undefined));
}

/** 그림 영역을 못 쟀을 때(jsdom 등) 쓰는 16:10 상자 */
const FALLBACK_FIG = { w: 1600, h: 1000 };

/**
 * 보정 중에 보일 배치(편집 화면과 같은 배치 좌표): 이번 세션에 없는 패드(패드 단위 재보정 때 나머지·페달)는 현재 배치 자리,
 * 끝난 패드는 실제 친 위치(앵커 평균 방향), 목표 패드는 현재 배치 자리
 */
function shownLayoutOf(cap: CaptureSnapshot, layout: KitLayout, angleRange: { yawDeg: number; pitchDeg: number }): KitLayout {
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
  const out = { ...layout };
  for (const pad of STICK_PADS) if (completed.includes(pad)) out[pad] = derived[pad];
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

/** 받을 손이 아닌 손이 친 지 WRONG_HAND_MS 안이면 그 기록을 돌려준다. 시간이 지나면 타이머가 가린다(렌더 중에는 시계를 읽지 않는다) */
function useWrongHand(cap: CaptureSnapshot | null): CaptureSnapshot['wrongHand'] {
  const w = cap?.wrongHand ?? null;
  const [hiddenAt, setHiddenAt] = useState<number | null>(null);
  useEffect(() => {
    if (!w) return;
    const id = window.setTimeout(() => setHiddenAt(w.at), Math.max(0, WRONG_HAND_MS - (performance.now() - w.at)));
    return () => window.clearTimeout(id);
  }, [w]);
  return w && hiddenAt !== w.at ? w : null;
}

export interface CalibrationStageProps {
  /** 재정렬 중 [처음부터 보정] 버튼. 없으면 버튼을 그리지 않는다 */
  onRestart?: () => void;
  /** 결과 화면의 [저장]: 세션을 끝내고(active) 또는 초안을 받아(new) 저장 흐름을 연다 */
  onSave?: () => void;
}

type HandGap = PadGap & { stickId: StickId };

/**
 * 손별로 20° 미만으로 붙은 패드 쌍(결과 화면). 세션 앵커에 세션 밖 앵커(cap.base, D14)를 합쳐 계산하되
 * 세션 패드가 하나라도 든 쌍만 남긴다(세션 밖 패드끼리의 쌍은 이번 보정과 무관). 손 순서, 손 안에서는 가까운 순
 */
function overlapsOf(cap: CaptureSnapshot): HandGap[] {
  const out: HandGap[] = [];
  for (const h of cap.hands) {
    const set: HandAnchorSet = {};
    for (const [pad, a] of Object.entries(cap.base?.[h] ?? {}) as [PadId, PadAnchor | undefined][]) {
      if (a && !cap.order.includes(pad)) set[pad] = a;
    }
    for (const pad of cap.order) {
      const a = cap.captured[pad]?.[h];
      if (a) set[pad] = a;
    }
    for (const g of padGaps(set, DEFAULT_CAPTURE_OPTIONS.minGapDeg)) {
      if (cap.order.includes(g.a) || cap.order.includes(g.b)) out.push({ ...g, stickId: h });
    }
  }
  return out;
}

const fmtCm = (v: number | undefined) => (v === undefined ? '–' : String(Math.round(v)));

/** 지금 패드를 받을 손마다 타격 점(●○)과 라벨 */
function HitDots({ cap, full }: { cap: CaptureSnapshot; full: boolean }) {
  const per = DEFAULT_CAPTURE_OPTIONS.hitsPerPad;
  return (
    <div className="cal-hands">
      {cap.targetHands.map((h) => {
        const n = full ? per : cap.counts[h];
        return (
          <div key={h} className="cal-hand-row" aria-label={`${HAND_NAME[h]} ${n}/${per}`}>
            <span className="cal-hand-name">{HAND_NAME[h]}</span>
            <span className="cal-hand-dots" aria-hidden="true">
              {Array.from({ length: per }, (_, i) => (
                <span key={i} className={`cal-hit-dot${i < n ? ' on' : ''}`} />
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function CalibrationStage({ onRestart, onSave }: CalibrationStageProps) {
  const cal = useLive((l) => l.calibration);
  const kitSkin = useSettings((s) => s.kitSkin);
  const tuning = useSettings((s) => s.tuning);
  const kitLayout = useSettings((s) => s.kitLayout);
  const padStates = usePadStates();
  const hitSeq = usePadHitSeq();
  const weak = useWeakHint(cal.capture);
  const wrongHand = useWrongHand(cal.capture);
  const [picked, setPicked] = useState<PadId | null>(null);
  const overlay = useOverlayRegion();
  const { cardRef, region, figSize } = overlay;

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
  const isDone = cap.phase === 'done';
  // 킷 전체를 어둡게 두고 지금 칠 패드만 켠다(Figma 766:34637). 끝난 패드는 실제 친 위치로 옮기고,
  // 세션 밖 패드(패드 단위 재보정의 나머지)는 현재 배치 자리. 새 프리셋(추가하기)은 기본 배치를 바탕으로 놓는다
  const base = cal.target === 'new' ? DEFAULT_KIT_LAYOUT : kitLayout;
  const shown = shownLayoutOf(cap, base, tuning.angleRange);
  const fig = figSize ?? FALLBACK_FIG;
  // 편집 화면과 같은 원근 자리에 같은 스킨 그림을 놓는다
  const frame = kitFrame(shown, fig, kitSkin, tuning.angleRange);

  // 결과 화면: 겹친 쌍과 선택 패드. 첫 선택은 겹침 있는 첫 패드, 없으면 첫 패드
  const overlaps = isDone ? overlapsOf(cap) : [];
  const warnPads = [...new Set(overlaps.flatMap((g) => [g.a, g.b]))];
  const selected: PadId | null = isDone ? (picked && cap.order.includes(picked) ? picked : (warnPads[0] ?? cap.order[0] ?? null)) : null;
  const onPadClick = isDone ? (pad: PadId) => cap.order.includes(pad) && setPicked(pad) : undefined;

  // 진행 중 간격 경고 배너: 멈추지 않는다. 다음 패드의 첫 타격이 수락되면 엔진이 gapWarnings를 비워 사라진다
  const gapWarnings = !isDone ? (cap.gapWarnings ?? []) : [];

  // 카드가 그림과 겹칠 때(좁은 판) 모든 패드 중 덜 가리는 모서리로. 지금 칠 패드(진행·경고)·선택 패드(결과)를 가리는 쪽은 피한다
  const focusPad = isDone ? selected : cap.target;
  const corner = pickOverlayCorner(padScreenCircles(shown, fig, tuning.angleRange), region, focusPad ? [focusPad] : [], fig);

  let card = null;
  if (isDone && selected) {
    const slot = cap.captured[selected] ?? [undefined, undefined];
    const point = padPointOf(selected, slot);
    const radius = previewRadius(cap, selected, tuning);
    const mine = overlaps.filter((g) => g.a === selected || g.b === selected);
    card = (
      <KitInfoOverlay
        cardRef={cardRef}
        corner={corner}
        name={PAD_META[selected].label}
        x={fmtCm(point?.x)}
        y={fmtCm(point?.y)}
        z={fmtCm(point?.z)}
        radius={`${Math.round(radius)}°`}
        caption="선택 패드"
        slider={{ value: radius, min: tuning.minRadiusDeg, max: tuning.maxRadiusDeg, onChange: (v) => calibrationSession.setRadiusOverride(selected, v) }}
      >
        {mine.length > 0 && (
          <p className="cal-overlap-line">
            {[...new Set(mine.map((g) => overlapLineText(g.a === selected ? g.b : g.a, g.deg)))].join(' · ')}
          </p>
        )}
        <div className="cal-kitinfo-actions">
          <Button variant="secondary" size="sm" onClick={() => calibrationSession.redo(selected)}>
            다시 치기
          </Button>
          <Button size="sm" onClick={() => onSave?.()}>
            저장
          </Button>
        </div>
      </KitInfoOverlay>
    );
  } else if (cap.target) {
    card = (
      <KitInfoFrame cardRef={cardRef} corner={corner}>
        <KitInfoHead name={PAD_META[cap.target].label} caption={`${cap.index + 1} / ${cap.order.length}`} nameClassName="cal-progress-title" />
        <HitDots cap={cap} full={cap.phase === 'padDone'} />
      </KitInfoFrame>
    );
  }

  const top = (
    <div className="cal-stage-top">
      {!isDone && cap.target && <p className="cal-stage-headline">{captureHeadline(cap.target, cap.targetHands)}</p>}
      <span className="cal-stage-progress" aria-label={`${completed.length} / ${cap.order.length} 패드 완료`}>
        {cap.order.map((pad) => (
          <span key={pad} className={`cal-stage-dot ${completed.includes(pad) ? 'done' : pad === cap.target ? 'now' : ''}`} title={PAD_META[pad].label} />
        ))}
      </span>
    </div>
  );
  const banner = isDone ? (
    overlaps.length > 0 ? <GapBanner kind="result" overlaps={overlaps} /> : null
  ) : gapWarnings.length > 0 ? (
    <GapBanner kind="progress" warnings={gapWarnings} onRedo={(pad) => calibrationSession.redo(pad)} />
  ) : null;

  return (
    <div className="cal-stage" data-testid="cal-stage-capture">
      <StagePanel layout={overlay} top={top} card={card} banner={banner}>
        <div className="cal-stage-canvas">
          <DrumKit
            frame={frame}
            skin={kitSkin}
            states={padStates}
            hitSeq={hitSeq}
            dimAll={!isDone}
            lit={isDone ? undefined : (cap.target ?? undefined)}
            warnPads={warnPads}
            selectedPad={selected ?? undefined}
            onPadClick={onPadClick}
          />
        </div>
      </StagePanel>
      {cap.warning && <p className="cal-stage-warn">{spreadWarningText(cap.warning)}</p>}
      {wrongHand && !cap.warning ? (
        <p className="cal-stage-hint">{wrongHandText(wrongHand.pad, cap.targetHands[0] ?? 1)}</p>
      ) : (
        weak && !cap.warning && <p className="cal-stage-hint">조금 세게 쳐 보세요</p>
      )}
    </div>
  );
}
