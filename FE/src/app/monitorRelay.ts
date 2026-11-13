// 모니터 따라보기 중계(설계 3-5·3-5-1). VITE_MONITOR 빌드에서만 bootstrap이 동적 import로 시작한다.
// 평소에는 packetTap·diagTap을 구독하지 않는다(비용 0). 모니터 창이 보내는 watch가 있는 동안(마지막 watch 후 3초)만
// 구독해 50ms 묶음으로 BroadcastChannel에 내보낸다. 판정 경로는 이 모듈을 모른다.
import { diagTap, type DiagEvent } from '@/engine/diagTap';
import type { TransportStats } from '@/input/source/InputSource';
import { packetTap, type PacketRecord } from '@/input/packetTap';

export const MONITOR_CHANNEL = 'ssaplash-monitor';

/** BroadcastChannel에서 쓰는 부분만. 테스트가 가짜를 넣는다 */
export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  close(): void;
}

export type RelayItem = { k: 'packet'; rec: PacketRecord } | { k: 'diag'; ev: DiagEvent };

/** 연주 창 상태. hello마다 bootstrap의 getter로 읽는다 */
export interface RelayInfo {
  /** 활성 센서 라벨 */
  source: string;
  profileId: string | null;
  offsets: [number | null, number | null];
  transport: TransportStats | null;
  /** 연주 창 오디오 지연(ms). 오디오가 꺼져 있으면 null */
  audio: { baseMs: number; outputMs: number } | null;
}

export interface RelayDeps {
  getInfo: () => RelayInfo;
  /** 기본 BroadcastChannel */
  createChannel?: () => ChannelLike;
  now?: () => number;
  timeOrigin?: () => number;
  pathname?: () => string;
}

/** watch가 이 시간 넘게 없으면 구독을 푼다 */
export const WATCH_TTL_MS = 3000;
const BATCH_MS = 50;
const HELLO_MS = 1000;

/** 중계 시작. 반환값은 정지 함수(채널 닫기·구독·타이머 정리) */
export function startMonitorRelay(deps: RelayDeps): () => void {
  const pathname = deps.pathname ?? (() => location.pathname);

  const channel = deps.createChannel ? deps.createChannel() : (new BroadcastChannel(MONITOR_CHANNEL) as unknown as ChannelLike);
  const timeOrigin = deps.timeOrigin ?? (() => performance.timeOrigin);
  const now = deps.now ?? (() => performance.now());
  // 창마다 다른 값. 모니터가 여러 연주 창 중 하나만 따르는 데 쓴다
  const id = Math.random().toString(36).slice(2, 10);

  let offTaps: (() => void) | null = null;
  let batchTimer: ReturnType<typeof setInterval> | null = null;
  let helloTimer: ReturnType<typeof setInterval> | null = null;
  let expireTimer: ReturnType<typeof setTimeout> | null = null;
  // 이벤트는 참조로 모았다가 보낼 때 복제된다 → 그 사이 채워진 tAudio가 실린다
  let pending: RelayItem[] = [];

  const sendHello = () => {
    const info = deps.getInfo();
    channel.postMessage({
      k: 'hello',
      id,
      source: info.source,
      profileId: info.profileId,
      origin: timeOrigin(),
      offsets: info.offsets,
      transport: info.transport,
      audio: info.audio,
      at: now(),
    });
  };
  const flush = () => {
    if (pending.length === 0) return;
    const items = pending;
    pending = [];
    channel.postMessage({ k: 'batch', id, items });
  };

  const unwatch = () => {
    offTaps?.();
    offTaps = null;
    if (batchTimer !== null) clearInterval(batchTimer);
    if (helloTimer !== null) clearInterval(helloTimer);
    if (expireTimer !== null) clearTimeout(expireTimer);
    batchTimer = helloTimer = expireTimer = null;
    pending = [];
  };

  const watch = () => {
    if (expireTimer !== null) clearTimeout(expireTimer);
    expireTimer = setTimeout(unwatch, WATCH_TTL_MS);
    if (offTaps) return;
    // bytes는 복사해 둔다: 소스가 버퍼를 재사용해도 안전하고, 큰 버퍼의 부분 뷰가 통째로 복제되는 것도 막는다
    const offPacket = packetTap.subscribe((rec) => pending.push({ k: 'packet', rec: { ...rec, bytes: rec.bytes.slice() } }));
    const offDiag = diagTap.subscribe((ev) => pending.push({ k: 'diag', ev }));
    offTaps = () => {
      offPacket();
      offDiag();
    };
    // 첫 batch보다 hello가 먼저 가야 모니터가 시각 정렬 값을 알 수 있다
    sendHello();
    helloTimer = setInterval(sendHello, HELLO_MS);
    batchTimer = setInterval(flush, BATCH_MS);
  };

  channel.onmessage = (e) => {
    const m = e.data as { k?: string } | null;
    // 모니터 화면에 있는 창은 응답하지 않는다(자기 자신 따라보기 방지). SPA라 시작 시점이 아니라 받을 때 본다
    if (m && m.k === 'watch' && !pathname().startsWith('/monitor')) watch();
  };
  // 새로 뜬 연주 창임을 알린다. 이미 따라보기 중인 모니터가 바로 watch로 답해, 다음 watch 주기(최대 1초)를
  // 기다리는 사이 곡 시작·첫 타격을 놓치지 않게 한다
  if (!pathname().startsWith('/monitor')) channel.postMessage({ k: 'ready' });

  return () => {
    unwatch();
    channel.onmessage = null;
    channel.close();
  };
}
