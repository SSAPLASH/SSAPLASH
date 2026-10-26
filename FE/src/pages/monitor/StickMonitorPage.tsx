// 스틱 패킷 모니터 페이지(/monitor/stick, EMB용). VITE_MONITOR=true 빌드에만 라우트가 있다.
// 이 파일은 연결(소스·송신·ParamStore)과 100ms 스냅샷 갱신만 맡고, 표시는 하위 컴포넌트가 한다.
// 판정·발음 경로(InputManager)에는 관여하지 않는다 — packetLog는 packetTap만 구독한다.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { sensorRegistry } from '@/app/sensorRegistry';
import { layoutToProfile } from '@/domain/kitJudge';
import type { InputSource } from '@/input/InputSource';
import { packetTap } from '@/input/packetTap';
import { decodePacket, PacketType } from '@/input/stickProtocol';
import { clockHealth, sensorHealth, transportHealth } from '@/monitor/health';
import { mockStick } from '@/monitor/mockStick';
import { packetLog } from '@/monitor/packetLog';
import { ParamStore } from '@/monitor/params';
import { downloadJsonl, Recorder, type RecordingMeta } from '@/monitor/recorder';
import { SwingAssembler } from '@/monitor/swingAssembler';
import { LossHistory } from '@/monitor/syncTrend';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { Sidebar } from './layout/Sidebar';
import { SECTION_ITEMS, type Section } from './layout/sections';
import { fmt, type SendFn, type Snap } from './monitorTypes';
import { ClockSection } from './sections/ClockSection';
import { ControlSection } from './sections/ControlSection';
import { Overview } from './sections/Overview';
import { PendingSection } from './sections/PendingSection';
import { SensorSection } from './sections/SensorSection';
import { TransportSection } from './sections/TransportSection';
import './monitor.css';

const SECTION_KEY = 'mon.section';

/** 마지막으로 본 섹션. 읽기에 실패하거나 알 수 없는 값이면 개요 */
function readSection(): Section {
  try {
    const v = localStorage.getItem(SECTION_KEY);
    if (SECTION_ITEMS.some((it) => it.key === v)) return v as Section;
  } catch {
    // 저장소를 못 쓰는 환경에서도 화면은 정상이다
  }
  return 'overview';
}

const SNAP_INTERVAL_MS = 100;

/**
 * 녹화기는 모듈 단위로 하나 둔다. 페이지를 떠났다 돌아와도 녹화가 이어져야 하기 때문이다(설계 4-1).
 * offAttach는 packetLog 구독 해제 함수다.
 */
const recorder = new Recorder();
let offAttach: (() => void) | null = null;

/** 시계 섹션 추이 패널의 POSE 유실률 이력. 섹션을 오가도 이어지도록 모듈에 둔다 */
const lossHistory = new LossHistory();

/** ParamStore가 항상 최신 send를 부르도록 두는 중간 상자. 소스·모의가 바뀌어도 ParamStore는 그대로 둔다 */
const sendHolder: { fn: SendFn } = { fn: () => {} };

export function StickMonitorPage() {
  const kitLayout = useSettings((s) => s.kitLayout);
  const tuning = useSettings((s) => s.tuning);
  const activeSensor = useLive((s) => s.activeSensor);
  const sourceState = useLive((s) => s.sourceState);

  // 활성 소스. 미등록·'none'이면 null
  const activeSource: InputSource | null = useMemo(() => {
    if (activeSensor === 'none') return null;
    try {
      return sensorRegistry.instance(activeSensor);
    } catch {
      return null;
    }
  }, [activeSensor]);
  const sourceLabel = activeSensor === 'none' ? '없음' : (sensorRegistry.get(activeSensor)?.label ?? activeSensor);

  // 판정에 쓰는 것과 같은 규칙의 프로필(fePad 계산·패드 테이블 전송·녹화 meta)
  const profile = useMemo(
    () =>
      layoutToProfile(kitLayout, tuning.angleRange, { maxRadiusDeg: tuning.maxRadiusDeg, radiusFactor: tuning.radiusFactor }),
    [kitLayout, tuning.angleRange, tuning.maxRadiusDeg, tuning.radiusFactor],
  );

  const [section, setSectionState] = useState<Section>(readSection);
  const setSection = useCallback((s: Section) => {
    setSectionState(s);
    try {
      localStorage.setItem(SECTION_KEY, s);
    } catch {
      // 기억하지 못해도 동작에는 영향이 없다
    }
  }, []);
  // Fold를 외부에서 여는 신호. 0이 아닌 새 값이 오면 연다. 사이드바로 옮겨 다닐 때는 0으로 되돌려
  // 섹션에 다시 들어왔을 때 지난 신호로 패널이 또 열리지 않게 한다
  const [openSwingSignal, setOpenSwingSignal] = useState(0);
  const [openTrendSignal, setOpenTrendSignal] = useState(0);
  const signalSeq = useRef(0);
  const selectSection = useCallback(
    (s: Section) => {
      setSection(s);
      setOpenSwingSignal(0);
      setOpenTrendSignal(0);
    },
    [setSection],
  );
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [mockOn, setMockOn] = useState(mockStick.running);
  const [mockSticks, setMockSticks] = useState<1 | 2>(2);
  const [recording, setRecording] = useState(recorder.recording);
  const [note, setNote] = useState('');

  // 시계 오프셋 조회 대상은 ref로 읽는다 — 소스가 바뀌어도 configure를 다시 하지 않는다
  const sourceRef = useRef<InputSource | null>(activeSource);
  useEffect(() => {
    sourceRef.current = activeSource;
  }, [activeSource]);

  const takeSnap = useCallback((tick: number, src: InputSource | null): Snap => {
    const now = performance.now();
    const offsets: [number | null, number | null] = [src?.clockOffsetOf?.(0) ?? null, src?.clockOffsetOf?.(1) ?? null];
    // 채택 오프셋은 읽은 직후 넘긴다(변화점만 기록). stats()보다 먼저 불러야 이번 스냅샷에 반영된다
    packetLog.noteAdoptedOffsets(now, offsets);
    const stats = packetLog.stats();
    lossHistory.push(now, [stats.perStick[0].poseSeqLoss.pct, stats.perStick[1].poseSeqLoss.pct]);
    return {
      tick,
      now,
      stats,
      rows: packetLog.rows().slice(),
      transport: src?.transportStats?.() ?? null,
      offsets,
    };
  }, []);
  const [snap, setSnap] = useState<Snap>(() => takeSnap(0, null));

  // 단계별 상태는 스냅샷이 바뀔 때만 다시 계산한다
  const health = useMemo(
    () => ({
      transport: transportHealth(snap, snap.now),
      sensor: sensorHealth(snap, snap.now),
      clock: clockHealth(snap, snap.now),
    }),
    [snap],
  );

  // 진입: 로그 수집 시작. 떠나도 stop하지 않는다(세션 동안 누적, 메모리는 링버퍼 상한)
  useEffect(() => {
    packetLog.configure({ clockOffsetOf: (s) => sourceRef.current?.clockOffsetOf?.(s) ?? null });
    packetLog.start();
  }, []);

  // 화면 갱신은 100ms 스냅샷으로 던진다. POSE가 50Hz×2로 와도 행마다 리렌더하지 않게 하려는 것이라
  // useSyncExternalStore(version) 대신 타이머로 version과 시간 의존 통계(경과 시간 등)를 함께 찍는다
  useEffect(() => {
    const id = setInterval(() => {
      if (!pausedRef.current) setSnap((prev) => takeSnap(prev.tick + 1, sourceRef.current));
    }, SNAP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [takeSnap]);

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };

  // 명령 송신. 모의 스틱이 켜져 있으면 모의로, 아니면 활성 소스로. 실제 소스는 sendCommand 안에서 이미
  // dir:'out'으로 packetTap에 publish하므로 여기서는 publish하지 않는다(중복 방지)
  const send: SendFn = useCallback(
    (bytes) => {
      if (mockStick.running) mockStick.handleCommand(bytes);
      else activeSource?.sendCommand?.(bytes);
    },
    [activeSource],
  );
  const canSend = mockOn || !!activeSource?.sendCommand;
  useEffect(() => {
    sendHolder.fn = send;
  }, [send]);

  // ParamStore는 페이지가 하나 만든다. PARAM_ACK는 packetLog를 거치지 않고 packetTap에서 바로 받는다 —
  // packetLog 일시정지·버퍼 밀림과 무관하게 응답을 놓치지 않고, 디코드도 PARAM_ACK 타입만 한다
  const paramStore = useMemo(() => new ParamStore((b) => sendHolder.fn(b)), []);
  useEffect(() => {
    const off = packetTap.subscribe((rec) => {
      if (rec.dir !== 'in' || rec.bytes[0] !== PacketType.PARAM_ACK) return;
      paramStore.onPacket(decodePacket(rec.bytes, rec.recvTime));
    });
    return () => {
      off();
      paramStore.reset(); // 대기 중 타이머 정리
    };
  }, [paramStore]);
  // 소스가 바뀌면 이전 소스의 파라미터 값은 무효다
  useEffect(() => {
    paramStore.reset();
  }, [activeSensor, paramStore]);

  // SwingAssembler도 ParamStore처럼 페이지가 1개 만든다. 청크는 packetLog 버퍼 밀림과 무관하게
  // packetTap에서 바로 받아야 조립이 끊기지 않고, 탭을 오가도 조립 결과가 유지된다
  const assembler = useMemo(() => new SwingAssembler(), []);
  const swingVersion = useSyncExternalStore(
    (fn) => assembler.subscribe(fn),
    () => assembler.version,
  );
  const [selectedSwing, setSelectedSwing] = useState<string | null>(null);
  useEffect(() => {
    const off = packetTap.subscribe((rec) => {
      if (rec.dir !== 'in' || rec.bytes[0] !== PacketType.SWING) return;
      const p = decodePacket(rec.bytes, rec.recvTime);
      if (p.kind !== 'swing') return;
      assembler.push(p, rec.stickId ?? ((p.role & 1) as 0 | 1), rec.recvTime);
    });
    return off;
  }, [assembler]);
  // 2초 타임아웃 확정은 100ms 스냅샷과 같은 주기로 확인한다
  useEffect(() => {
    const id = setInterval(() => assembler.tick(), SNAP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [assembler]);
  // HIT 행 클릭: 센서 섹션에서 SWING 패널을 열고 그 스윙을 고른다
  const onSelectHit = useCallback(
    (stick: 0 | 1, seq: number) => {
      setSelectedSwing(`${stick}-${seq}`);
      setSection('sensor');
      setOpenSwingSignal(++signalSeq.current);
    },
    [setSection],
  );

  // 산점 점 클릭: 센서 섹션의 같은 스틱·seq HIT 행을 강조·스크롤한다
  const [hitPick, setHitPick] = useState<{ stick: 0 | 1; seq: number } | null>(null);
  const goHit = useCallback(
    (stick: 0 | 1, seq: number) => {
      setHitPick({ stick, seq });
      setSection('sensor');
    },
    [setSection],
  );
  // 개요 ③ 상자: 시계 섹션으로 가서 추이 패널을 연다
  const goTrend = useCallback(() => {
    setSection('clock');
    setOpenTrendSignal(++signalSeq.current);
  }, [setSection]);

  const toggleMock = () => {
    if (mockStick.running) {
      mockStick.stop();
      setMockOn(false);
    } else {
      mockStick.start({ sticks: mockSticks });
      setMockOn(true);
    }
  };

  const toggleRecord = () => {
    if (recorder.recording) {
      offAttach?.();
      offAttach = null;
      downloadJsonl(recorder.stop());
      setRecording(false);
      return;
    }
    const stats = packetLog.stats();
    const fw = stats.perStick[0].lastStatus ?? stats.perStick[1].lastStatus;
    const meta: RecordingMeta = {
      startedAt: new Date().toISOString(),
      source: { kind: mockStick.running ? 'mock' : activeSensor, label: mockStick.running ? '모의 스틱' : sourceLabel },
      firmware: fw ? `${fw.fwMajor}.${fw.fwMinor}` : null,
      build: stats.build,
      profile: Object.values(profile.anchors).flatMap((a) =>
        a ? [{ pad: a.pad, pitch: a.pitch, yaw: a.yaw, radiusDeg: a.radius }] : [],
      ),
      note,
    };
    recorder.start(meta);
    offAttach = recorder.attach(packetLog);
    setRecording(true);
  };

  return (
    <main className="main wide mon">
      <div className="mon-bar">
        <h1 className="mon-title">스틱 패킷 모니터</h1>
        <span className="mon-source">
          소스 <strong>{sourceLabel}</strong> · {sourceState}
          {mockOn && <span className="badge warn">모의 스틱</span>}
        </span>
        <span className="faint small">
          {fmt(snap.stats.total, 0)}건 수신 · 버퍼 {snap.rows.length}
        </span>
        <div className="mon-actions">
          <input
            className="mon-input note"
            placeholder="녹화 메모"
            value={note}
            disabled={recording}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className={recording ? 'btn-primary small' : 'btn-ghost small'} onClick={toggleRecord}>
            {recording ? `녹화 정지·저장 (${recorder.lineCount})` : '녹화 시작'}
          </button>
          <button className={paused ? 'btn-primary small' : 'btn-ghost small'} onClick={togglePause}>
            {paused ? '재개' : '일시정지'}
          </button>
          <select
            value={mockSticks}
            disabled={mockOn}
            onChange={(e) => setMockSticks(Number(e.target.value) as 1 | 2)}
            aria-label="모의 스틱 수"
          >
            <option value={1}>모의 1스틱</option>
            <option value={2}>모의 2스틱</option>
          </select>
          <button className={mockOn ? 'btn-primary small' : 'btn-ghost small'} onClick={toggleMock}>
            {mockOn ? '모의 끄기' : '모의 스틱'}
          </button>
          <button className="btn-ghost small" onClick={() => {
              packetLog.clear();
              lossHistory.clear();
            }}>
            지우기
          </button>
        </div>
      </div>
      {paused && <div className="notice small">화면 갱신이 멈춰 있습니다. 버퍼에는 계속 쌓입니다.</div>}

      <div className="mon-layout">
        <Sidebar current={section} onSelect={selectSection} health={health} />
        <div className="mon-body">
          {section === 'overview' && (
            <Overview
              health={health}
              now={snap.now}
              sourceLabel={sourceLabel}
              mockOn={mockOn}
              onSelect={selectSection}
              onGoTrend={goTrend}
            />
          )}
          {section === 'transport' && <TransportSection health={health.transport} snap={snap} />}
          {section === 'sensor' && (
            <SensorSection
              health={health.sensor}
              snap={snap}
              profile={profile}
              angleRange={tuning.angleRange}
              hitPick={hitPick}
              onSelectHit={onSelectHit}
              onPickHit={goHit}
              assembler={assembler}
              swingVersion={swingVersion}
              selectedSwing={selectedSwing}
              onSelectSwing={setSelectedSwing}
              openSwingSignal={openSwingSignal}
              send={send}
              canSend={canSend}
            />
          )}
          {section === 'clock' && (
            <ClockSection health={health.clock} snap={snap} loss={lossHistory} openTrendSignal={openTrendSignal} />
          )}
          {section === 'resolve' && <PendingSection title="④ 판정" />}
          {section === 'score' && <PendingSection title="⑤ 채점" />}
          {section === 'output' && <PendingSection title="⑥ 출력" />}
          {section === 'trace' && <PendingSection title="타격 추적" />}
          {section === 'control' && <ControlSection store={paramStore} send={send} profile={profile} canSend={canSend} />}
        </div>
      </div>
    </main>
  );
}
