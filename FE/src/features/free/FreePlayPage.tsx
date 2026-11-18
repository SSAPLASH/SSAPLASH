// 자유 연습 (MODE-02, Figma 112:76·112:146·228:5881, 설계 4-4 · 무대 개편 MODE-002-free-stage). 채보 없이 치면 바로 울린다.
// 소리·텔레메트리는 bootstrap의 공용 경로가 내고, 이 페이지는 표시(무대·패드 점등·키트 가이드·HUD)와
// 포인터 기준면 등록만 맡는다. 앵커 거리·패드별 통계 같은 실측 UI는 모니터 빌드(FreeMeasureSection)로 옮겼다.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LiveDrumKit } from '@/components/drum/LiveDrumKit';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { useRecentHits } from '@/components/drum/useRecentHits';
import { AccompanimentBar } from './AccompanimentBar';
import { AccompanimentPicker } from './AccompanimentPicker';
import { useFreeAccompaniment } from '@/components/song/useFreeAccompaniment';
import { DisconnectBand } from './DisconnectBand';
import { RealignPrompt } from '@/components/calibration/RealignPrompt';
import { useRealign } from '@/components/calibration/useRealign';
import { useDock } from '@/components/shell/nav/useShell';
import { Button } from '@/components/ui/action/Button';
import { EmptyState } from '@/components/ui/feedback/EmptyState';
import { FreeHud } from './components/FreeHud';
import { KitGuideSwitch } from './components/KitGuide';
import { KitGuideLabels } from '@/components/drum/KitGuideLabels';
import { StageBeam, StageFloor } from '@/components/drum/StageLights';
import { kitGuideLabels } from '@/domain/kit/kitGuide';
import './free.css';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { audioEngine } from '@/audio/AudioEngine';
import { usePresets } from '@/store/presetStore';
import { useReconnect } from '@/store/reconnectStore';
import { SYSTEM_PRESET_NAME, presetDisplayName } from '@/domain/kit/preset';
import { freeStage } from './freeStage';
import { pedalConnected, pedalRequired } from '@/domain/kit/device/pedalStatus';
import { addHit, emptyHitStats, meanVelocity } from '@/domain/play/hitStats';
import { inputManager, KEYBOARD_INPUT_ENABLED, touchSource } from '@/runtime/sources';
import { stopFree } from '@/runtime/recordingStore';
import { sensorRegistry } from '@/runtime/sensorRegistry';
import { bindSensorSurface } from '@/runtime/sensorSession';
import { setSoundOnHit } from '@/runtime/hitSound';
import { useKeyboardDrum } from '@/runtime/keyboardDrum';
import { unlockAudio } from '@/runtime/audioUnlock';
import type { PadId } from '@/domain/kit/pads';

/** 킷 최대 배율(설계 D7). 폭이 좁으면 fitContain이 어차피 폭에 맞춰 줄인다 */
const KIT_SCALE = 1.6;

/** 빈 상태 조준 아이콘(Figma 112:146) */
function TargetIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}

export function FreePlayPage() {
  const navigate = useNavigate();
  const sensorKind = useSettings((s) => s.sensorKind);
  const kitGuide = useSettings((s) => s.kitGuide);
  const setKitGuide = useSettings((s) => s.setKitGuide);
  const activePresetId = useSettings((s) => s.activePresetId);
  const presetItems = usePresets((s) => s.items);
  const connected = useLive((s) => s.connected);
  const pedalPair = useLive((s) => s.pedal.connected);
  const reconnect = useReconnect((s) => s.status);
  const attempt = useReconnect((s) => s.attempt);
  const max = useReconnect((s) => s.max);
  const reconnectHint = useReconnect((s) => s.hint);
  const reconnectAvailable = useReconnect((s) => s.available);
  const doReconnect = useReconnect((s) => s.reconnect);

  const padStates = usePadStates();
  const hitSeq = usePadHitSeq();
  const kitSkin = useSettings((s) => s.kitSkin);
  const lastHit = useRecentHits(1)[0];
  // 스틱이 다시 켜진 손이 있으면 스네어 재정렬 띠(다른 손은 계속 친다, PLAY-004 4-2)
  const realign = useRealign(true);
  const [stats, setStats] = useState(emptyHitStats);
  // 이름표 켜짐용 패드별 타격 횟수. 킷 점등(hitSeq)과 달리 하이햇 페달을 하이햇으로 합치지 않는다
  const [labelSeq, setLabelSeq] = useState<Partial<Record<PadId, number>>>({});
  // 반주(MODE-002 설계 D1): 페이지가 재생기를 하나 들고 떠나면 해제한다
  const accomp = useFreeAccompaniment();
  // 자유 연습은 화면에 있는 동안 키보드 드럼을 켠다
  useKeyboardDrum(true);
  // Dock은 자유 연습 화면에 있는 동안 둔다(QA 352 Q8)
  useDock(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  // 진입: 타격음 켜기(기본은 꺼져 있다), 채보 후보 제한 해제. 떠날 때 타격음을 끈다
  useEffect(() => {
    setSoundOnHit(true);
    inputManager.setCandidateProvider(null);
    return () => setSoundOnHit(false);
  }, []);

  // 떠날 때 녹음 중이면 정지해 저장 창으로 넘긴다(녹음 중이 아니면 스토어가 무시한다)
  useEffect(() => {
    return () => stopFree('leave');
  }, []);

  // 세션 통계. 자세(60Hz)와 분리하려고 store를 직접 구독한다. 페이지를 떠나면 사라진다
  useEffect(() => {
    return useLive.subscribe((s, prev) => {
      if (s.hitSeq === prev.hitSeq || !s.lastHit) return;
      const hit = s.lastHit;
      setStats((st) => addHit(st, hit));
      const pad = hit.pad;
      if (pad) setLabelSeq((q) => ({ ...q, [pad]: (q[pad] ?? 0) + 1 }));
    });
  }, []);

  const desc = sensorKind === 'none' ? undefined : sensorRegistry.get(sensorKind);
  const stage = freeStage({ sensorKind, hasUsageGuide: !!desc?.usageGuide, connected });
  const empty = stage === 'empty';
  // 동글 소스만 페달을 본다. 손은 멀쩡한데 페달만 끊겨도 띠를 보인다(연주는 계속)
  const pedal = pedalRequired(sensorKind) ? pedalConnected({ connected: pedalPair }) : undefined;
  const showBand = stage === 'oneHand' || (stage === 'ready' && pedal === false);
  const mean = meanVelocity(stats);
  const presetName = presetDisplayName(presetItems, activePresetId) ?? SYSTEM_PRESET_NAME;
  // 키트 가이드: 실물은 이름표 알약(키보드로 칠 때만 키), 전자·네온은 내장 글자를 스위치로 켜고 끈다(D6)
  const showKeys = sensorKind === 'none' && KEYBOARD_INPUT_ENABLED;
  const guideLabels = useMemo(() => kitGuideLabels(kitSkin, showKeys), [kitSkin, showKeys]);
  const acoustic = kitSkin === 'acoustic';

  // 터치 연주(MODE-002). 오디오가 깨어 있으면 동기 경로로 바로 친다. 첫 터치만 깨운 뒤 친다
  const onPadDown = (pad: PadId) => {
    // audioReady는 첫 해제 때만 바뀌므로, 통화·백그라운드로 멈춘 뒤에도 다시 깨우도록 엔진 상태를 직접 본다
    if (audioEngine.ready) touchSource.strike(pad);
    else void unlockAudio().then(() => touchSource.strike(pad));
  };

  const openSetup = () => navigate('/setup', { state: { returnTo: '/free', returnLabel: '자유 연습' } });

  return (
    <main className={`main free-page${empty ? ' is-empty' : ''}`}>
      <StageBeam on={!empty} />
      <AccompanimentBar
        view={accomp.view}
        onPick={accomp.available ? () => setPickerOpen(true) : undefined}
        onPause={accomp.pause}
        onResume={accomp.resume}
        onSeek={accomp.seek}
        onOff={accomp.off}
        onRetry={accomp.retry}
      />
      {pickerOpen && (
        <AccompanimentPicker
          currentSongId={accomp.view.pick?.songId ?? null}
          currentPlaying={accomp.view.phase === 'playing'}
          onPick={(song) => {
            setPickerOpen(false);
            accomp.pick(song);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <section className={`free-stage${empty ? ' is-empty' : ''}`} aria-label="연주 캔버스">
        <div className="free-stage-head">
          <div className="free-stage-title">
            <h2>드럼 킷</h2>
            <span>프리셋: {presetName} · 8패드</span>
          </div>
          <KitGuideSwitch on={kitGuide} onChange={setKitGuide} />
        </div>

        <div className="free-kit-zone">
          <div ref={bindSensorSurface} className="free-kit" data-pointer-strike="">
            <div className="free-kit-inner" aria-hidden={empty || undefined}>
              <LiveDrumKit
                fitContain
                effects
                scale={KIT_SCALE}
                states={padStates}
                skin={kitSkin}
                hitSeq={hitSeq}
                labels={acoustic ? false : kitGuide}
                underlay={<StageFloor />}
                overlay={acoustic ? <KitGuideLabels labels={guideLabels} visible={kitGuide && !empty} hitSeq={labelSeq} /> : undefined}
                onPadDown={empty ? undefined : onPadDown}
              />
            </div>
          </div>

          {showBand ? (
            <DisconnectBand
              left={connected[0]}
              right={connected[1]}
              pedal={pedal}
              reconnect={{ status: reconnect, attempt, max, hint: reconnectHint }}
              onReconnect={reconnectAvailable ? () => void doReconnect() : undefined}
            />
          ) : (
            realign.info && (
              <div className="free-band motion-toast" role="status">
                <RealignPrompt hands={realign.info.hands} done={realign.info.done} unstable={realign.info.unstable} variant="band" onSkip={realign.info.onSkip} />
              </div>
            )
          )}

          {empty && (
            <div className="free-empty-wrap">
              <EmptyState
                className="free-empty-card"
                icon={<TargetIcon />}
                title="스틱을 연결하면 바로 칠 수 있어요"
                description="연결되면 무대에 조명이 켜집니다."
                action={<Button onClick={openSetup}>드럼 세팅에서 연결하기</Button>}
              />
            </div>
          )}
        </div>

        <FreeHud
          pad={lastHit?.pad ?? undefined}
          hand={lastHit?.hand ?? null}
          velocity={lastHit?.velocity}
          total={stats.total}
          mean={mean}
        />
      </section>
    </main>
  );
}
