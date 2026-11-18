// 보정·재정렬 본문(PLAY-004 4-1·4-2, 개편 D2·D3·D6·D10·D11·D14, v0.2 · SETUP-fixed-kit-noir D5·D11). 보정 중(capture)에는 보정 팝업(CalibrationDialog)의 본문이다:
// 큰 안내(「하이햇을 2번 타격하세요」, 패드 이름은 브랜드색) · 진행 점 · 드럼 그림(항상 기본 배치, 전체 어둡게 0.18 + 지금 칠 패드만 원래 밝기·글로우, 팝업이 열릴 때는 그 위에 첫 안내 CaptureNotice) · 아래 손별 타격 점·약한 타격 안내.
// 간격 경고는 멈추지 않는다: 진행 중에는 배너([◯◯ 다시])로, 다음 패드를 치면 사라진다. 결과 화면(done)은 「n곳 모두 잡았어요」 + 같은 손에서 20° 미만으로 붙은 패드(세션 밖 앵커 base 포함, D14)를
// 문구(「스네어와 스몰탐이 너무 가까워요(14°)」)와 [◯◯ 다시] 버튼으로 알리고 그 패드에 --warn 테두리를 그린 뒤 [저장]한다. 그림이 고정이라 붙어 보이지 않으므로 문구가 대신한다.
// 실수 안내(v0.4 D15~D20): 평소에는 없고 실수가 이어질 때만 하나(hint/hintPick) — 같은 지점·멀어질 방향은 드럼 그림 위(CaptureHint), 방향 그림은 그림 영역 모서리(AimGuide).
// 재정렬 중(② 카드): 스네어 유령 + RealignPrompt. 계산·전송은 하지 않는다: liveStore.calibration 스냅샷을 읽고 calibrationSession 액션만 부른다.
import { useEffect, useRef, useState } from 'react';
import { DrumKit } from '@/components/drum/DrumKit';
import { LiveDrumKit } from '@/components/drum/LiveDrumKit';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { Button } from '@/components/ui/action/Button';
import { RealignPrompt } from '@/components/calibration/RealignPrompt';
import { CaptureNotice } from './CaptureNotice';
import { useCaptureNotice } from './useCaptureNotice';
import { AimGuide } from './hint/AimGuide';
import { CaptureHint } from './hint/CaptureHint';
import { hintBox, padRing } from './hint/hintGeometry';
import { STUCK_HINT_MS, pickCaptureHint } from './hint/hintPick';
import { GapBanner } from './GapBanner';
import { HAND_NAME, captureHeadline, overlapPairText, spreadWarningText, wrongHandText } from '@/components/calibration/calibrationText';
import { calibrationSession } from '@/runtime/calibrationSession';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { DEFAULT_CAPTURE_OPTIONS, type CaptureSnapshot } from '@/engine/HitCapture';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { captureHandsFor } from '@/domain/kit/calibration/captureHands';
import { angleBetween, padGaps, type HandAnchorSet, type PadAnchor, type PadGap } from '@/domain/kit/calibration/calibration';
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

const NO_IDLE = { weak: false, stuck: false } as const;

/**
 * 스틱이 움직이는데 타격이 안 들어오는지. weak = WEAK_HINT_MS 넘게 없음(「조금 세게」 안내, 움직이는 동안만),
 * stuck = STUCK_HINT_MS 넘게 없음(방향 그림). stuck은 한 번 켜지면 타격이 수락되거나 패드가 바뀔 때까지 켜 둔다(스틱이 잠깐 멈춰도 깜빡이지 않게).
 * stuck의 기준 시각은 마지막 수락 타격과 패드가 바뀐 때([◯◯ 다시] 포함) 가운데 늦은 쪽
 */
function useIdleHints(cap: CaptureSnapshot | null): { weak: boolean; stuck: boolean } {
  const [hints, setHints] = useState<{ weak: boolean; stuck: boolean }>(NO_IDLE);
  const lastPose = useRef<[Pose, Pose] | null>(null);
  useEffect(() => {
    const startAt = performance.now();
    let target: PadId | null | undefined;
    let targetAt = startAt;
    let stuck = false;
    lastPose.current = useLive.getState().pose;
    const set = (weak: boolean, next: boolean) => setHints((prev) => (prev.weak === weak && prev.stuck === next ? prev : { weak, stuck: next }));
    const id = window.setInterval(() => {
      const c = useLive.getState().calibration.capture;
      if (!c || c.phase !== 'capturing') {
        target = c?.target ?? null;
        stuck = false;
        set(false, false);
        return;
      }
      const now = performance.now();
      if (c.target !== target) {
        target = c.target;
        targetAt = now;
      }
      const pose = useLive.getState().pose;
      const prev = lastPose.current ?? pose;
      const moved = ([0, 1] as const).some((i) => angleBetween(pose[i], prev[i]) >= MOVING_DEG);
      lastPose.current = pose;
      const acceptedAt = c.lastAccepted?.at ?? startAt;
      if (now - Math.max(acceptedAt, targetAt) <= STUCK_HINT_MS) stuck = false;
      else if (moved) stuck = true;
      set(moved && now - acceptedAt > WEAK_HINT_MS, stuck);
    }, 500);
    return () => window.clearInterval(id);
  }, []);
  return cap !== null ? hints : NO_IDLE;
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
  /** 보정 팝업에서만 켠다: 열릴 때 드럼 그림 가운데에 첫 안내(CaptureNotice)를 겹쳐 띄운다 */
  notice?: boolean;
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

/** 킷 최대 배율(드럼 세팅 무대와 같다). 폭·높이가 모자라면 fitContain이 줄인다 */
const KIT_SCALE = 1.6;

/** 큰 안내 문장에서 맨 앞 패드 이름만 브랜드색으로 강조한다 */
function Headline({ text, pad }: { text: string; pad: PadId }) {
  const label = PAD_META[pad].label;
  if (!text.startsWith(label)) return <>{text}</>;
  return (
    <>
      <em className="cal-stage-pad">{label}</em>
      {text.slice(label.length)}
    </>
  );
}

/** 겹친 쌍(양손에서 겹쳐도 한 쌍, 더 가까운 각도) 목록. 가까운 순 */
function uniquePairs(overlaps: readonly HandGap[]): { a: PadId; b: PadId; deg: number }[] {
  const pairs = new Map<string, { a: PadId; b: PadId; deg: number }>();
  for (const g of overlaps) {
    const key = [g.a, g.b].sort().join('|');
    const prev = pairs.get(key);
    if (!prev || g.deg < prev.deg) pairs.set(key, { a: g.a, b: g.b, deg: g.deg });
  }
  return [...pairs.values()].sort((x, y) => x.deg - y.deg);
}

export function CalibrationStage({ onRestart, onSave, notice = false }: CalibrationStageProps) {
  const noticeOpen = useCaptureNotice(notice);
  const cal = useLive((l) => l.calibration);
  const kitSkin = useSettings((s) => s.kitSkin);
  const padStates = usePadStates();
  const hitSeq = usePadHitSeq();
  const { weak, stuck } = useIdleHints(cal.capture);
  const wrongHand = useWrongHand(cal.capture);

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

  // 결과 화면: 겹친 쌍. 쌍에 든 패드마다 [다시] 버튼
  const overlaps = isDone ? overlapsOf(cap) : [];
  const pairs = uniquePairs(overlaps);
  const warnPads = [...new Set(overlaps.flatMap((g) => [g.a, g.b]))];

  // 진행 중 간격 경고 배너: 멈추지 않는다. 다음 패드의 첫 타격이 수락되면 엔진이 gapWarnings를 비워 사라진다
  const gapWarnings = !isDone ? (cap.gapWarnings ?? []) : [];

  // 실수 안내: 한 번에 하나. 방향 그림(aim)은 칠 패드의 반대편 모서리에 둔다
  const hint = pickCaptureHint(cap, stuck, noticeOpen);
  const aimRing = hint?.kind === 'aim' ? padRing(kitSkin, hint.pad) : null;
  const aimSide = aimRing && aimRing.cx < hintBox(kitSkin).w / 2 ? 'right' : 'left';

  return (
    <div className="cal-stage cal-stage-capture" data-testid="cal-stage-capture">
      <div className="cal-stage-top">
        <p className="cal-stage-headline">
          {isDone ? `${cap.order.length}곳 모두 잡았어요` : cap.target ? <Headline text={captureHeadline(cap.target, cap.targetHands)} pad={cap.target} /> : null}
        </p>
        <span className="cal-stage-progress" aria-label={`${completed.length} / ${cap.order.length} 패드 완료`}>
          {cap.order.map((pad) => (
            <span key={pad} className={`cal-stage-dot ${completed.includes(pad) ? 'done' : pad === cap.target ? 'now' : ''}`} title={PAD_META[pad].label} />
          ))}
        </span>
      </div>

      {/* 드럼 그림: 항상 기본 배치. 진행 중에는 칠 패드만 켜고 나머지는 어둡게, 결과에서는 전부 밝게 + 겹친 패드만 경고 테두리 */}
      <div className="cal-stage-canvas">
        <LiveDrumKit
          fitContain
          scale={KIT_SCALE}
          skin={kitSkin}
          states={padStates}
          hitSeq={hitSeq}
          dimAll={!isDone}
          lit={isDone ? undefined : (cap.target ?? undefined)}
          warnPads={warnPads}
          overlay={<CaptureHint key={hint ? `${hint.kind}-${hint.pad}` : 'none'} hint={hint} skin={kitSkin} />}
        />
        {hint?.kind === 'aim' && <AimGuide key={`${hint.pad}-${hint.stickId}`} pad={hint.pad} stickId={hint.stickId} side={aimSide} />}
        {notice && <CaptureNotice open={noticeOpen} />}
      </div>

      <div className="cal-stage-bottom">
        {isDone ? (
          <div className="cal-result">
            {pairs.length > 0 && (
              <ul className="cal-result-overlaps" data-testid="cal-result-overlaps">
                {pairs.map((g) => (
                  <li key={`${g.a}-${g.b}`} className="cal-overlap-line">
                    {overlapPairText(g.a, g.b, g.deg)}
                  </li>
                ))}
              </ul>
            )}
            <div className="cal-result-actions">
              {warnPads.map((pad) => (
                <Button key={pad} variant="secondary" size="sm" onClick={() => calibrationSession.redo(pad)}>
                  {PAD_META[pad].label} 다시
                </Button>
              ))}
              <Button className="cal-result-save" onClick={() => onSave?.()}>
                저장
              </Button>
            </div>
          </div>
        ) : (
          <>
            {gapWarnings.length > 0 && <GapBanner kind="progress" warnings={gapWarnings} onRedo={(pad) => calibrationSession.redo(pad)} />}
            {cap.target && <HitDots cap={cap} full={cap.phase === 'padDone'} />}
          </>
        )}
        {cap.warning && <p className="cal-stage-warn">{spreadWarningText(cap.warning)}</p>}
        {wrongHand && !cap.warning ? (
          <p className="cal-stage-hint">{wrongHandText(wrongHand.pad, cap.targetHands[0] ?? 1)}</p>
        ) : (
          weak && !cap.warning && <p className="cal-stage-hint">조금 세게 쳐 보세요</p>
        )}
      </div>
    </div>
  );
}
