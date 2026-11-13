// 스틱 패킷 모니터 페이지(/monitor/stick, EMB용). VITE_MONITOR=true 빌드에만 라우트가 있다.
// 이 파일은 연결(소스·송신·ParamStore)과 100ms 스냅샷 갱신만 맡고, 표시는 하위 컴포넌트가 한다.
// 판정·발음 경로(InputManager)에는 관여하지 않는다 — 입력은 monitor/feed(직접 연결: packetTap·diagTap, 따라보기: 채널)로만 받는다.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { activateSensor } from '@/runtime/sensorSession';
import { sensorRegistry } from '@/runtime/sensorRegistry';
import { audioEngine } from '@/audio/AudioEngine';
import { anchorsToProfile } from '@/domain/kit/kitJudge';
import type { InputSource } from '@/input/source/InputSource';
import { decodePacket, PacketType } from '@/input/stickProtocol';
import { feed, type FeedMode } from '@/features/monitor/core/feed';
import { clockHealth, keyMetrics, outputHealth, resolveHealth, scoreHealth, sensorHealth, transportHealth } from '@/features/monitor/core/health';
import { JudgeLog } from '@/features/monitor/core/recording/judgeLog';
import { LatencyStatsLog } from '@/features/monitor/core/latencyStats';
import { mockStick } from '@/features/monitor/core/mockStick';
import { packetLog } from '@/features/monitor/core/recording/packetLog';
import { ParamStore } from '@/features/monitor/core/params';
import { buildTimeline } from '@/features/monitor/core/recording/replay';
import { downloadJsonl, parseJsonl, Recorder, type RecordingMeta } from '@/features/monitor/core/recording/recorder';
import { summarizeRecording, type RecordingSummary } from '@/features/monitor/core/recording/recordingSummary';
import { SwingAssembler } from '@/features/monitor/core/swingAssembler';
import { buildTrace, type TraceSelection } from '@/features/monitor/core/recording/traceIndex';
import { LossHistory } from '@/features/monitor/core/syncTrend';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { KeyMetricsBar } from '@/features/monitor/layout/KeyMetricsBar';
import { ReplayBar } from '@/features/monitor/layout/ReplayBar';
import { Sidebar } from '@/features/monitor/layout/Sidebar';
import { SECTION_ITEMS, type Section } from '@/features/monitor/layout/sections';
import { fmt, type SendFn, type Snap } from './monitorTypes';
import { ClockSection } from '@/features/monitor/sections/ClockSection';
import { ControlSection } from '@/features/monitor/sections/ControlSection';
import { FreeMeasureSection } from '@/features/monitor/sections/FreeMeasureSection';
import { Overview } from '@/features/monitor/sections/Overview';
import { OutputSection } from '@/features/monitor/sections/OutputSection';
import { ResolveSection } from '@/features/monitor/sections/ResolveSection';
import { ScoreSection } from '@/features/monitor/sections/ScoreSection';
import { SensorSection } from '@/features/monitor/sections/SensorSection';
import { TraceSection } from '@/features/monitor/sections/TraceSection';
import { TransportSection } from '@/features/monitor/sections/TransportSection';
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
let offAttachDiag: (() => void) | null = null;

/** 녹화 중 이 탭이 숨겨진 동안의 탭 제목(PLAY-006). 브라우저가 숨긴 탭의 타이머를 늦춰 그 구간 기록이 빠질 수 있다 */
const HIDDEN_TAB_TITLE = '⚠ 녹화 탭 숨김';

/** 시계 섹션 추이 패널의 POSE 유실률 이력. 섹션을 오가도 이어지도록 모듈에 둔다 */
const lossHistory = new LossHistory();

/**
 * ④ 판정·⑤ 채점·⑥ 출력 기록. feed(직접 연결: 이 창의 diagTap, 따라보기: 연주 창 중계)를 구독해 채운다. recorder·lossHistory처럼 모듈에 둬
 * 탭(섹션)을 오가도 이어진다. 구독은 첫 진입에서 한 번 걸고 떠나도 풀지 않는다(세션 동안 누적, 메모리는 링버퍼 상한).
 */
const judgeLog = new JudgeLog();
const latencyLog = new LatencyStatsLog();
let offDiag: (() => void) | null = null;
function startDiag(): void {
  if (offDiag) return;
  offDiag = feed.subscribeDiag((ev) => {
    judgeLog.push(ev);
    latencyLog.push(ev);
  });
}

/** ParamStore가 항상 최신 send를 부르도록 두는 중간 상자. 소스·모의가 바뀌어도 ParamStore는 그대로 둔다 */
const sendHolder: { fn: SendFn } = { fn: () => {} };

/** ?follow=1로 열렸으면 따라보기로 시작하고, 아니면 feed가 기억한 모드(처음이면 직접 연결) */
function initialMode(): FeedMode {
  // 재생은 페이지를 떠날 때 닫으므로 처음엔 없다. 혹시 남아 있으면 직접 연결로 시작한다
  if (feed.mode === 'replay') return 'direct';
  try {
    if (new URLSearchParams(location.search).get('follow') === '1') return 'follow';
  } catch {
    // 주소를 못 읽으면 기억한 모드를 쓴다
  }
  return feed.mode;
}

export function StickMonitorPage() {
  const stickAnchors = useSettings((s) => s.stickAnchors);
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
  // 모니터는 오른손 프로필을 대표로 쓴다(손별 표는 PLAY-004). 보정 전이면 3D 모델 기본 앵커
  const profile = useMemo(() => anchorsToProfile(stickAnchors[1], tuning, 1), [stickAnchors, tuning]);

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
  const [mode, setMode] = useState<FeedMode>(initialMode);
  // 따라보기로 바꿀 때 모의 스틱을 멈춘다(모의 패킷이 이 창의 탭으로만 흘러 따라보기와 섞이지 않게)
  const changeMode = (next: FeedMode) => {
    if (next === 'follow' && mockStick.running) {
      mockStick.stop();
      setMockOn(false);
    }
    // 재생에서 나가면 재생 데이터가 남지 않게 화면 상태를 비운다
    if (mode === 'replay') {
      clearAll();
      setReplayName(null);
    }
    setMode(next);
  };
  const follow = mode === 'follow';
  const replaying = mode === 'replay';
  // 재생을 열기 전 입력 방식. 닫으면 여기로 돌아간다
  const beforeReplay = useRef<FeedMode>('direct');
  const [replayName, setReplayName] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [mockOn, setMockOn] = useState(mockStick.running);
  const [mockSticks, setMockSticks] = useState<1 | 2>(2);
  const [recording, setRecording] = useState(recorder.recording);
  const [note, setNote] = useState('');
  // 녹화 중 탭이 숨겨졌던 시간 합계(ms). 녹화를 멈추거나 새로 시작하면 0으로 되돌린다
  const [hiddenMs, setHiddenMs] = useState(0);
  // 녹화 요약 패널에 보일 요약. 녹화 정지 직후 또는 파일 열기로 채운다
  const [summary, setSummary] = useState<RecordingSummary | null>(null);

  // 시계 오프셋 조회 대상은 ref로 읽는다 — 소스가 바뀌어도 configure를 다시 하지 않는다
  const sourceRef = useRef<InputSource | null>(activeSource);
  useEffect(() => {
    sourceRef.current = activeSource;
  }, [activeSource]);

  // 입력 방식 적용. 따라보기에서는 모의 스틱을 멈추고 이 창의 센서를 해제한다(연결은 연주 창이 가진다).
  // 설정 sensorKind는 바꾸지 않아 직접 연결로 돌아오면 저장된 센서를 다시 연다
  useEffect(() => {
    feed.setMode(mode);
    // 재생에서도 이 창의 센서는 해제한다(재생 패킷에 실제 패킷이 섞이지 않게)
    if (mode === 'follow' || mode === 'replay') {
      void activateSensor('none');
    } else {
      void activateSensor(useSettings.getState().sensorKind);
    }
  }, [mode]);

  // 녹화 중에만 탭 숨김을 듣는다: 숨겨지면 vis 줄 + 탭 제목 경고, 돌아오면 vis 줄 + 제목 복구 + 숨겨진 시간 합산.
  // 녹화가 끝나거나 화면을 떠날 때(숨겨진 채 멈추는 경우 포함) 제목을 되돌린다. 열린 숨김 구간은 요약이 마지막 줄 시각까지로 닫는다
  useEffect(() => {
    if (!recording) return;
    const originalTitle = document.title;
    let hiddenSince: number | null = document.hidden ? performance.now() : null;
    const onVisibility = () => {
      const now = performance.now();
      if (document.hidden) {
        if (hiddenSince !== null) return;
        hiddenSince = now;
        recorder.appendVis(true, now);
        document.title = HIDDEN_TAB_TITLE;
      } else {
        recorder.appendVis(false, now);
        document.title = originalTitle;
        if (hiddenSince !== null) {
          const span = now - hiddenSince;
          setHiddenMs((ms) => ms + span);
        }
        hiddenSince = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.title = originalTitle;
    };
  }, [recording]);

  const takeSnap = useCallback((tick: number, src: InputSource | null): Snap => {
    const now = performance.now();
    // 따라보기: 오프셋·전송 통계는 연주 창이 보낸 hello 값(이 창 시각 기준으로 옮겨 둔 것)
    const fs = feed.mode === 'follow' ? feed.followStatus() : null;
    const replay = feed.mode === 'replay';
    // 재생: 녹화의 SYNC 짝에서 다시 구한 오프셋(재생 시각 기준)
    const offsets: [number | null, number | null] = fs
      ? fs.offsets
      : replay
        ? feed.replaySnapshotOffsets()
        : [src?.clockOffsetOf?.(0) ?? null, src?.clockOffsetOf?.(1) ?? null];
    // 채택 오프셋은 읽은 직후 넘긴다(변화점만 기록). stats()보다 먼저 불러야 이번 스냅샷에 반영된다
    packetLog.noteAdoptedOffsets(now, offsets);
    const stats = packetLog.stats();
    lossHistory.push(now, [stats.perStick[0].poseSeqLoss.pct, stats.perStick[1].poseSeqLoss.pct]);
    const rows = packetLog.rows().slice();
    // 오디오 지연은 판정 경로가 아니라 여기서 읽는다(오디오가 꺼져 있으면 null)
    const lat = audioEngine.latency();
    return {
      tick,
      now,
      stats,
      rows,
      transport: fs ? fs.transport : replay ? null : (src?.transportStats?.() ?? null),
      offsets,
      pedalOffset: fs || replay ? null : (src?.clockOffsetOf?.(2) ?? null),
      judge: judgeLog.stats(rows),
      latency: latencyLog.stats(),
      // 따라보기: 오디오는 연주 창 것이라 hello 값을 쓴다
      audio: fs ? fs.audio : replay ? null : lat ? { baseMs: lat.baseLatencyMs, outputMs: lat.outputLatencyMs } : null,
    };
  }, []);
  const [snap, setSnap] = useState<Snap>(() => takeSnap(0, null));

  // 상단 바 표시용. 렌더(스냅샷 100ms마다)마다 읽는다
  const followStatus = feed.followStatus();
  const replayStatus = feed.replayStatus();

  // 단계별 상태는 스냅샷이 바뀔 때만 다시 계산한다
  const health = useMemo(
    () => ({
      transport: transportHealth(snap, snap.now),
      sensor: sensorHealth(snap, snap.now),
      clock: clockHealth(snap, snap.now),
      resolve: resolveHealth(snap.judge.resolve, snap.now),
      score: scoreHealth(snap.judge.score, snap.now),
      output: outputHealth(snap.latency, snap.audio, snap.now),
    }),
    [snap],
  );

  // 핵심 수치 바는 스냅샷 10번(약 1초)에 한 번만 값을 새로 만든다(바가 메모로 렌더를 건너뛴다)
  const keyTick = Math.floor(snap.tick / 10);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const keyBar = useMemo(() => keyMetrics(snap, snap.now), [keyTick]);

  // 진입: 로그 수집 시작. 떠나도 stop하지 않는다(세션 동안 누적, 메모리는 링버퍼 상한)
  useEffect(() => {
    packetLog.configure({
      clockOffsetOf: (s) =>
        feed.mode === 'follow'
          ? feed.followStatus().offsets[s]
          : feed.mode === 'replay'
            ? feed.replayOffsetOf(s)
            : (sourceRef.current?.clockOffsetOf?.(s) ?? null),
    });
    packetLog.start((fn) => feed.subscribePacket(fn));
    startDiag();
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
      if (follow || replaying) return; // 따라보기·재생은 읽기 전용(U4)
      if (mockStick.running) mockStick.handleCommand(bytes);
      else activeSource?.sendCommand?.(bytes);
    },
    [activeSource, follow, replaying],
  );
  const canSend = !follow && !replaying && (mockOn || !!activeSource?.sendCommand);
  useEffect(() => {
    sendHolder.fn = send;
  }, [send]);

  // ParamStore는 페이지가 하나 만든다. PARAM_ACK·STATUS는 packetLog를 거치지 않고 packetTap에서 바로 받는다 —
  // packetLog 일시정지·버퍼 밀림과 무관하게 응답을 놓치지 않고, 디코드도 두 타입만 한다
  const paramStore = useMemo(() => new ParamStore((b) => sendHolder.fn(b)), []);
  useEffect(() => {
    const off = feed.subscribePacket((rec) => {
      // STATUS는 fwMajor(기본값 표 선택)용으로 함께 받는다
      if (rec.dir !== 'in' || (rec.bytes[0] !== PacketType.PARAM_ACK && rec.bytes[0] !== PacketType.STATUS)) return;
      paramStore.onPacket(decodePacket(rec.bytes, rec.recvTime));
    });
    return () => {
      off();
      paramStore.reset(); // 대기 중 타이머 정리
    };
  }, [paramStore]);
  // 소스나 입력 방식이 바뀌면 이전 소스의 파라미터 값은 무효다
  useEffect(() => {
    paramStore.reset();
  }, [activeSensor, mode, paramStore]);

  // SwingAssembler도 ParamStore처럼 페이지가 1개 만든다. 청크는 packetLog 버퍼 밀림과 무관하게
  // packetTap에서 바로 받아야 조립이 끊기지 않고, 탭을 오가도 조립 결과가 유지된다
  const assembler = useMemo(() => new SwingAssembler(), []);
  const swingVersion = useSyncExternalStore(
    (fn) => assembler.subscribe(fn),
    () => assembler.version,
  );
  const [selectedSwing, setSelectedSwing] = useState<string | null>(null);
  useEffect(() => {
    const off = feed.subscribePacket((rec) => {
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
  // 같은 클릭으로 공통 선택(타격 추적)도 정한다
  const [traceSel, setTraceSel] = useState<TraceSelection | null>(null);
  // 화면 상태 비우기("지우기"·재생 시작·재생 닫기·처음부터)
  const clearAll = useCallback(() => {
    packetLog.clear();
    lossHistory.clear();
    judgeLog.clear();
    latencyLog.clear();
    assembler.clear();
    setSelectedSwing(null);
    setTraceSel(null);
  }, [assembler]);
  const onSelectHit = useCallback(
    (stick: 0 | 1, seq: number, t: number) => {
      setSelectedSwing(`${stick}-${seq}`);
      setTraceSel({ kind: 'packet', stick, seq, t });
      setSection('sensor');
      setOpenSwingSignal(++signalSeq.current);
    },
    [setSection],
  );
  // ⑤ 판정 행 클릭: 그 타격을 고르고 타격 추적으로 이동
  const onSelectJudged = useCallback(
    (hitId: number) => {
      setTraceSel({ kind: 'hit', hitId });
      setSection('trace');
      setOpenSwingSignal(0);
      setOpenTrendSignal(0);
    },
    [setSection],
  );
  const openTrace = useCallback(() => selectSection('trace'), [selectSection]);
  // 선택한 타격의 카드. 스냅샷·조립 결과가 바뀔 때만 다시 만든다
  const traceCard = useMemo(
    () =>
      traceSel
        ? buildTrace(traceSel, { rows: snap.rows, events: judgeLog.events(), hasSwing: (k) => assembler.get(k) !== undefined })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [traceSel, snap, swingVersion, assembler],
  );
  const sideSelected = useMemo(
    () => (traceSel ? { summary: traceCard?.summary ?? null } : null),
    [traceSel, traceCard],
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

  // 페이지를 떠나면 재생을 닫는다(feed는 모듈 단위라 남겨 두면 다른 입력과 섞인다)
  useEffect(
    () => () => {
      if (feed.mode === 'replay') feed.setMode('direct');
    },
    [],
  );

  // 녹화 파일 열기 → 재생 모드. 모의 스틱은 끄고, 화면 상태를 비운 뒤 시작한다(요약은 패널이 따로 채운다)
  const startReplay = (parsed: ReturnType<typeof parseJsonl>, name: string) => {
    if (mockStick.running) {
      mockStick.stop();
      setMockOn(false);
    }
    if (mode !== 'replay') beforeReplay.current = mode;
    clearAll();
    feed.openReplay(buildTimeline(parsed));
    setReplayName(name);
    setMode('replay');
  };
  const closeReplay = () => {
    clearAll();
    setReplayName(null);
    setMode(beforeReplay.current);
  };
  const restartReplay = () => {
    clearAll();
    feed.replayRestart();
  };
  const toggleReplay = () => {
    const st = feed.replayStatus();
    if (!st) return;
    if (st.state === 'playing') feed.replayPause();
    else if (st.state === 'ended') restartReplay();
    else feed.replayPlay();
  };

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
      offAttachDiag?.();
      offAttachDiag = null;
      const text = recorder.stop();
      downloadJsonl(text);
      // 방금 녹화를 파일과 같은 경로(되읽기)로 요약해 파일을 다시 열었을 때와 같은 결과를 보인다
      try {
        setSummary(summarizeRecording(parseJsonl(text)));
      } catch {
        setSummary(null);
      }
      setRecording(false);
      setHiddenMs(0);
      return;
    }
    setHiddenMs(0);
    const stats = packetLog.stats();
    const fw = stats.perStick[0].lastStatus ?? stats.perStick[1].lastStatus;
    const meta: RecordingMeta = {
      startedAt: new Date().toISOString(),
      source: follow
        ? { kind: 'follow', label: `연주 창: ${feed.followStatus().source ?? '없음'}` }
        : { kind: mockStick.running ? 'mock' : activeSensor, label: mockStick.running ? '모의 스틱' : sourceLabel },
      firmware: fw ? `${fw.fwMajor}.${fw.fwMinor}` : null,
      build: stats.build,
      profile: Object.values(profile.anchors).flatMap((a) =>
        a ? [{ pad: a.pad, pitch: a.pitch, yaw: a.yaw, radiusDeg: a.radius }] : [],
      ),
      note,
      inputMode: follow ? 'follow' : 'direct',
    };
    recorder.start(meta);
    offAttach = recorder.attach(packetLog);
    offAttachDiag = recorder.attachDiag((l) => feed.subscribeDiag(l));
    setRecording(true);
  };

  return (
    <main className="main wide mon">
      <div className="mon-bar">
        <h1 className="mon-title">스틱 패킷 모니터</h1>
        <select value={mode} onChange={(e) => changeMode(e.target.value as FeedMode)} aria-label="입력 방식">
          <option value="direct">직접 연결</option>
          <option value="follow">따라보기</option>
          {replaying && (
            <option value="replay" disabled>
              녹화 재생
            </option>
          )}
        </select>
        <span className="mon-source">
          {replaying ? (
            <>
              녹화 재생 · <strong>{replayName ?? '–'}</strong>
              <span className="badge">읽기 전용</span>
            </>
          ) : follow ? (
            <>
              연주 창: <strong>{followStatus.source ?? '–'}</strong> · {followStatus.connected ? '연결됨' : '연주 창 없음'}
              <span className="badge">읽기 전용</span>
            </>
          ) : (
            <>
              소스 <strong>{sourceLabel}</strong> · {sourceState}
              {mockOn && <span className="badge warn">모의 스틱</span>}
            </>
          )}
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
          <button className={recording ? 'btn-primary small' : 'btn-ghost small'} disabled={replaying} onClick={toggleRecord}>
            {recording ? `녹화 정지·저장 (${recorder.lineCount})` : '녹화 시작'}
          </button>
          <button className={paused ? 'btn-primary small' : 'btn-ghost small'} onClick={togglePause}>
            {paused ? '재개' : '일시정지'}
          </button>
          <select
            value={mockSticks}
            disabled={mockOn || follow || replaying}
            onChange={(e) => setMockSticks(Number(e.target.value) as 1 | 2)}
            aria-label="모의 스틱 수"
          >
            <option value={1}>모의 1스틱</option>
            <option value={2}>모의 2스틱</option>
          </select>
          <button className={mockOn ? 'btn-primary small' : 'btn-ghost small'} disabled={follow || replaying} onClick={toggleMock}>
            {mockOn ? '모의 끄기' : '모의 스틱'}
          </button>
          <button className="btn-ghost small" onClick={() => {
              packetLog.clear();
              lossHistory.clear();
              judgeLog.clear();
              latencyLog.clear();
              setTraceSel(null);
            }}>
            지우기
          </button>
        </div>
      </div>
      {recording && hiddenMs > 0 && (
        <p className="mon-hidden-warn warn" role="status">
          녹화 중 이 탭이 {Math.max(1, Math.round(hiddenMs / 1000))}초 숨겨졌어요. 그 구간은 기록이 빠졌을 수 있어요.
        </p>
      )}
      {replaying && replayStatus && (
        <ReplayBar
          name={replayName ?? ''}
          status={replayStatus}
          onToggle={toggleReplay}
          onRestart={restartReplay}
          onSpeed={(sp) => feed.replaySetSpeed(sp)}
          onClose={closeReplay}
        />
      )}
      <KeyMetricsBar metrics={keyBar} />
      {paused && <div className="notice small">화면 갱신이 멈춰 있습니다. 버퍼에는 계속 쌓입니다.</div>}

      <div className="mon-layout">
        <Sidebar current={section} onSelect={selectSection} health={health} selected={sideSelected} onOpenTrace={openTrace} />
        <div className="mon-body">
          {section === 'overview' && (
            <Overview
              health={health}
              now={snap.now}
              sourceLabel={follow ? `연주 창 ${followStatus.source ?? '–'} (${followStatus.connected ? '연결됨' : '연주 창 없음'})` : sourceLabel}
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
          {section === 'resolve' && <ResolveSection health={health.resolve} snap={snap} judgeLog={judgeLog} />}
          {section === 'score' && <ScoreSection health={health.score} snap={snap} judgeLog={judgeLog} onSelectTrace={onSelectJudged} />}
          {section === 'output' && <OutputSection health={health.output} snap={snap} latency={latencyLog} />}
          {section === 'trace' && (
            <TraceSection
              snap={snap}
              judgeLog={judgeLog}
              selection={traceSel}
              card={traceCard}
              onSelect={setTraceSel}
              assembler={assembler}
              swingVersion={swingVersion}
              send={send}
              canSend={canSend}
            />
          )}
          {section === 'free' && <FreeMeasureSection />}
          {section === 'control' && <ControlSection store={paramStore} send={send} profile={profile} canSend={canSend} follow={follow} summary={summary} onSummary={setSummary} canReplay={!recording} onReplay={startReplay} />}
        </div>
      </div>
    </main>
  );
}
