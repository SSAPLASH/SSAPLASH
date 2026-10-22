// 자유 연주 (MODE-02, 설계 4-3). 채보 없이 치면 바로 울린다.
// 소리·텔레메트리는 bootstrap의 공용 경로가 내고, 이 페이지는 표시(플래시·최근 타격·통계)와
// 포인터 기준면 등록만 맡는다. 화면 구조는 Claude Design UI로 교체 예정이라 최소로 둔다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { KitCanvas } from '@/components/KitCanvas';
import { ReadinessNotice } from '@/components/ReadinessNotice';
import { useHitFx } from '@/components/useHitFx';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { LANE_ORDER, PAD_META, type PadId } from '@/domain/pads';
import type { HitFx } from '@/domain/events';
import { layoutToProfile } from '@/domain/kitJudge';
import { addHit, emptyHitStats, meanSensorDistance } from '@/domain/hitStats';
import { inputManager, KEYBOARD_INPUT_ENABLED } from '@/app/sources';
import { KEY_MAP } from '@/domain/keyMap';
import { resolveOptions, sensorRegistry } from '@/app/sensorRegistry';
import { bindSensorSurface, setSoundOnHit } from '@/app/bootstrap';

const keyLabel = (code: string) => code.replace('Key', '').replace('Space', 'Space').replace('Digit', '');

export function FreePlayPage() {
  const kitLayout = useSettings((s) => s.kitLayout);
  const tuning = useSettings((s) => s.tuning);
  const sensorKind = useSettings((s) => s.sensorKind);
  const sensorOptions = useSettings((s) => s.sensorOptions);
  const activeSensor = useLive((s) => s.activeSensor);
  const pose = useLive((s) => s.pose);
  const lastHit = useLive((s) => s.lastHit);
  const sourceState = useLive((s) => s.sourceState);
  const sourceMessage = useLive((s) => s.sourceMessage);
  const connected = useLive((s) => s.connected);

  const hits = useRef(new Map<PadId, HitFx>());
  useHitFx(hits);
  const [stats, setStats] = useState(emptyHitStats);

  // 진입: 소리 켜기 복구(리듬 게임이 꺼 두었을 수 있음), 채보 후보 제한 해제
  useEffect(() => {
    setSoundOnHit(true);
    inputManager.setCandidateProvider(null);
  }, []);

  // 타격마다 통계(이펙트는 useHitFx). 자세(60Hz)와 분리하려고 store를 직접 구독한다
  useEffect(() => {
    return useLive.subscribe((s, prev) => {
      if (s.hitSeq === prev.hitSeq || !s.lastHit) return;
      const hit = s.lastHit;
      setStats((st) => addHit(st, hit));
    });
  }, []);

  // 판정 원은 배치에서 유도한 프로필로 그린다(판정과 같은 규칙)
  const anchors = useMemo(
    () =>
      layoutToProfile(kitLayout, tuning.angleRange, { maxRadiusDeg: tuning.maxRadiusDeg, radiusFactor: tuning.radiusFactor }).anchors,
    [kitLayout, tuning.angleRange, tuning.maxRadiusDeg, tuning.radiusFactor],
  );
  const sensorOn = activeSensor !== 'none';
  const nearest = lastHit && lastHit.source !== 'keyboard' ? inputManager.previewPad(lastHit.pose) : null;
  const meanDist = meanSensorDistance(stats);

  // 안내 줄 (설계 4-3 표)
  let guide: React.ReactNode;
  if (sensorKind === 'none') {
    guide = (
      <>
        키보드로 칩니다.{' '}
        {KEYBOARD_INPUT_ENABLED &&
          LANE_ORDER.map((pad) => (
          <span key={pad} style={{ marginRight: 8 }}>
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
  } else {
    const desc = sensorRegistry.get(sensorKind);
    if (desc?.usageGuide) {
      // 연결 개념이 없는 소스(포인터 모의 IMU)는 연결 상태 대신 조작 안내를 보여준다
      guide = desc.usageGuide(resolveOptions(desc, sensorOptions[sensorKind]));
    } else {
      const conn =
        sourceState === 'error'
          ? `오류: ${sourceMessage ?? '알 수 없음'}`
          : sourceState === 'connecting'
            ? '연결 중…'
            : connected[0] || connected[1]
              ? `연결됨 (${connected[0] ? '왼손' : ''}${connected[0] && connected[1] ? '·' : ''}${connected[1] ? '오른손' : ''})`
              : '연결 안 됨 — 세팅에서 연결하세요.';
      guide = (
        <>
          {desc?.label ?? sensorKind} {conn}
        </>
      );
    }
  }

  return (
    <main className="main wide">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1>자유 연주</h1>
        <span className="small dim">채보 없이 전체 패드가 바로 울립니다</span>
      </div>
      <p className="small dim" style={{ marginBottom: 12 }}>
        {guide}
      </p>

      <ReadinessNotice returnTo="/free" />

      <div className="grid-2">
        <div className="card col">
          <KitCanvas
            layout={kitLayout}
            keyMap={KEYBOARD_INPUT_ENABLED ? KEY_MAP : undefined}
            anchors={anchors}
            angleRange={tuning.angleRange}
            hits={hits}
            poses={pose}
            showPoses={sensorOn}
            surfaceRef={bindSensorSurface}
          />
        </div>

        <div className="col">
          <div className="card col">
            <h3>최근 타격</h3>
            {lastHit ? (
              <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                <div className="stat">
                  <span className="v" style={{ color: lastHit.pad ? PAD_META[lastHit.pad].color : 'inherit' }}>
                    {lastHit.pad ? PAD_META[lastHit.pad].label : '판정 없음'}
                  </span>
                  <span className="k">패드</span>
                </div>
                <div className="stat">
                  <span className="v">{lastHit.stickId === 0 ? 'L' : 'R'}</span>
                  <span className="k">손</span>
                </div>
                <div className="stat">
                  <span className="v">{lastHit.velocity}</span>
                  <span className="k">벨로시티</span>
                </div>
                <div className="stat">
                  <span className="v" style={{ fontSize: 20 }}>
                    {lastHit.source}
                  </span>
                  <span className="k">소스</span>
                </div>
                {nearest && (
                  <div className="stat">
                    <span className="v" style={{ fontSize: 20 }}>
                      {PAD_META[nearest.pad].label} {nearest.distanceDeg.toFixed(1)}°
                    </span>
                    <span className="k">{nearest.inside ? '앵커 안' : '가장 가까운 패드 (앵커 밖)'}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="small faint">아직 타격이 없습니다. 쳐 보세요.</p>
            )}
          </div>

          <div className="card col">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>타격 통계</h3>
              <button className="btn-ghost small" onClick={() => setStats(emptyHitStats())}>
                초기화
              </button>
            </div>
            <table>
              <tbody>
                {LANE_ORDER.map((pad) => (
                  <tr key={pad}>
                    <td style={{ color: PAD_META[pad].color }}>{PAD_META[pad].label}</td>
                    <td style={{ textAlign: 'right' }}>{stats.byPad[pad]}</td>
                  </tr>
                ))}
                <tr>
                  <td className="dim">판정 없음</td>
                  <td style={{ textAlign: 'right' }}>{stats.unresolved}</td>
                </tr>
                <tr>
                  <td className="dim">합계</td>
                  <td style={{ textAlign: 'right' }}>{stats.total}</td>
                </tr>
                <tr>
                  <td className="dim">센서 타격 평균 앵커 거리</td>
                  <td style={{ textAlign: 'right' }}>{meanDist === null ? '–' : `${meanDist.toFixed(1)}°`}</td>
                </tr>
              </tbody>
            </table>
            <p className="small faint">페이지를 떠나면 사라집니다. 판정 반경(U6)·앵커 밖 처리(U11) 실측용.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
