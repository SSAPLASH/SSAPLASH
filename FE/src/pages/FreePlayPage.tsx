// 자유 연습 (MODE-02, Figma 112:76·112:146·228:5881, 설계 4-4). 채보 없이 치면 바로 울린다.
// 소리·텔레메트리는 bootstrap의 공용 경로가 내고, 이 페이지는 표시(패드 점등·최근 타격·세션 통계)와
// 포인터 기준면 등록만 맡는다. 앵커 거리·패드별 통계 같은 실측 UI는 모니터 빌드(FreeMeasureSection)로 옮겼다.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DrumKit } from '@/components/drum/DrumKit';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { useRecentHits } from '@/components/drum/useRecentHits';
import { AccompanimentBar } from '@/components/free/AccompanimentBar';
import { DisconnectBand } from '@/components/free/DisconnectBand';
import { HitReadout } from '@/components/play/HitReadout';
import { TABLET_QUERY, useMediaQuery } from '@/components/shell/useMediaQuery';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import '@/components/free/free.css';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { usePresets } from '@/store/presetStore';
import { useReconnect } from '@/store/reconnectStore';
import { ALL_PADS, PAD_META } from '@/domain/pads';
import { freeStage } from '@/domain/freeStage';
import { addHit, emptyHitStats, meanVelocity } from '@/domain/hitStats';
import { inputManager, KEYBOARD_INPUT_ENABLED } from '@/app/sources';
import { stopFree } from '@/app/recordingStore';
import { KEY_MAP } from '@/domain/keyMap';
import { resolveOptions, sensorRegistry } from '@/app/sensorRegistry';
import { bindSensorSurface, setSoundOnHit } from '@/app/bootstrap';

/** 킷 최대 배율(Figma 1.25, 태블릿 ≤1024는 1.1) */
const KIT_SCALE = 1.25;
const KIT_SCALE_TABLET = 1.1;

const keyLabel = (code: string) => code.replace('Key', '').replace('Digit', '');

/** 빈 상태 조준 아이콘(Figma 112:146) */
function TargetIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}

/** 키보드 전용일 때 안내 줄의 패드별 키 */
function KeyGuide() {
  return (
    <>
      키보드로 칩니다.{' '}
      {KEYBOARD_INPUT_ENABLED &&
        ALL_PADS.map((pad) => (
          <span key={pad} className="free-guide-pad">
            <span style={{ color: PAD_META[pad].color }}>{PAD_META[pad].label}</span>{' '}
            {Object.entries(KEY_MAP)
              .filter(([, b]) => b.pad === pad)
              .map(([code]) => (
                <kbd className="kbd" key={code}>
                  {keyLabel(code)}
                </kbd>
              ))}
          </span>
        ))}
    </>
  );
}

export function FreePlayPage() {
  const navigate = useNavigate();
  const tablet = useMediaQuery(TABLET_QUERY);
  const sensorKind = useSettings((s) => s.sensorKind);
  const sensorOptions = useSettings((s) => s.sensorOptions);
  const activePresetId = useSettings((s) => s.activePresetId);
  const presetItems = usePresets((s) => s.items);
  const connected = useLive((s) => s.connected);
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
  const [stats, setStats] = useState(emptyHitStats);

  // 진입: 소리 켜기 복구(리듬 게임이 꺼 두었을 수 있음), 채보 후보 제한 해제
  useEffect(() => {
    setSoundOnHit(true);
    inputManager.setCandidateProvider(null);
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
    });
  }, []);

  const desc = sensorKind === 'none' ? undefined : sensorRegistry.get(sensorKind);
  const stage = freeStage({ sensorKind, hasUsageGuide: !!desc?.usageGuide, connected });
  const empty = stage === 'empty';
  const mean = meanVelocity(stats);
  const preset = presetItems.find((p) => p.id === activePresetId);

  let guide: React.ReactNode;
  if (empty) guide = '연결 대기 중 · 스틱을 연결해 주세요';
  else if (sensorKind === 'none') guide = <KeyGuide />;
  else if (desc?.usageGuide) guide = desc.usageGuide(resolveOptions(desc, sensorOptions[sensorKind]));
  else guide = '스틱을 움직여 자유롭게 연주하세요';

  const openSetup = () => navigate('/setup', { state: { returnTo: '/free', returnLabel: '자유 연습' } });

  return (
    <main className="main free-page">
      <AccompanimentBar />

      <Card className="free-canvas" aria-label="연주 캔버스">
        <div className="free-canvas-head">
          <h2 className="free-canvas-title">드럼 킷</h2>
          <span className="free-canvas-meta">프리셋: {preset?.name ?? '없음'} · 8패드</span>
        </div>

        {stage === 'oneHand' && (
          <DisconnectBand
            left={connected[0]}
            right={connected[1]}
            reconnect={{ status: reconnect, attempt, max, hint: reconnectHint }}
            onReconnect={reconnectAvailable ? () => void doReconnect() : undefined}
          />
        )}

        <div ref={bindSensorSurface} className={`free-kit${empty ? ' is-dim' : ''}`}>
          <div className="free-kit-inner" aria-hidden={empty || undefined}>
            <DrumKit fitWidth scale={tablet ? KIT_SCALE_TABLET : KIT_SCALE} states={padStates} skin={kitSkin} hitSeq={hitSeq} />
          </div>
        </div>

        {empty && (
          <div className="free-empty-wrap">
            <EmptyState
              icon={<TargetIcon />}
              title="스틱을 연결하면 바로 칠 수 있어요"
              action={<Button onClick={openSetup}>드럼 세팅에서 연결하기</Button>}
            />
          </div>
        )}

        <p className={`free-guide${empty ? ' is-wait' : ''}`}>{guide}</p>
      </Card>

      <div className="free-info">
        <div className="free-info-block">
          <span className="free-info-key">최근 타격</span>
          <HitReadout
            variant="row"
            pad={lastHit?.pad ?? undefined}
            hand={lastHit?.hand === 0 ? 'L' : lastHit?.hand === 1 ? 'R' : null}
            velocity={lastHit?.velocity}
          />
        </div>
        <div className="free-info-block">
          <span className="free-info-key">세션 통계</span>
          <div className="free-info-stats">
            <span>
              타격 <span className="num">{stats.total}</span>회
            </span>
            <span>
              평균 세기 <span className="num">{mean === null ? '—' : Math.round(mean)}</span>
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
