import { describe, expect, it } from 'vitest';
import type { DiagEvent } from '@/engine/diagTap';
import { encodeSync } from '@/input/stickProtocol';
import { buildSyncAck } from '@/features/monitor/core/mockStick';
import type { RecordedRow } from './recorder';
import { buildTimeline, ReplayOffsets, ReplayPlayer } from './replay';

const row = (t: number, n = 0): RecordedRow => ({ t, dir: 'in', transport: 'mock', stick: 0, hex: `0${n}`, decoded: null });
const diag = (t: number): DiagEvent => ({ type: 'judged', t, hitId: 1 }) as unknown as DiagEvent;

describe('buildTimeline', () => {
  it('패킷·진단을 원래 t 순으로 합치고 같은 t는 패킷이 먼저', () => {
    const tl = buildTimeline({ rows: [row(100), row(300), row(200)], diags: [diag(200), diag(150)] });
    expect(tl.items.map((i) => `${i.k}${i.t}`)).toEqual(['packet100', 'diag150', 'packet200', 'diag200', 'packet300']);
    expect(tl.startT).toBe(100);
    expect(tl.durationMs).toBe(200);
    expect(tl.packetCount).toBe(3);
    expect(tl.diagCount).toBe(2);
  });

  it('진단 줄이 없는 이전 형식·빈 녹화도 만든다', () => {
    expect(buildTimeline({ rows: [row(5), row(9)], diags: [] }).durationMs).toBe(4);
    const empty = buildTimeline({ rows: [], diags: [] });
    expect(empty.items).toHaveLength(0);
    expect(empty.durationMs).toBe(0);
  });
});

describe('ReplayPlayer', () => {
  const tl = () => buildTimeline({ rows: [row(1000), row(1100), row(1300), row(1500)], diags: [] });
  const ts = (p: ReplayPlayer, now: number) => p.take(now).map((d) => d.item.t);

  it('재생 전에는 아무것도 내보내지 않고, 재생하면 경과 시간만큼 내보낸다', () => {
    const p = new ReplayPlayer(tl());
    expect(p.state).toBe('paused');
    expect(ts(p, 50)).toEqual([]);
    p.play(100);
    expect(ts(p, 100)).toEqual([1000]);
    expect(ts(p, 250)).toEqual([1100]);
    const due = p.take(450);
    expect(due.map((d) => d.item.t)).toEqual([1300]);
    // 틱이 늦어도 원래 도착 시각(wall)으로 돌려준다
    expect(due[0].wallT).toBe(400);
    expect(p.positionMs(450)).toBe(350);
  });

  it('끝까지 내보내면 ended, 위치는 전체 길이에서 멈춘다', () => {
    const p = new ReplayPlayer(tl());
    p.play(0);
    expect(ts(p, 10_000)).toEqual([1000, 1100, 1300, 1500]);
    expect(p.state).toBe('ended');
    expect(p.positionMs(20_000)).toBe(500);
  });

  it('배속: 바꾸기 전 구간은 원래 속도로, 이후는 배속으로 계산한다', () => {
    const p = new ReplayPlayer(tl());
    p.play(0);
    expect(ts(p, 100)).toEqual([1000, 1100]);
    p.setSpeed(2, 100);
    expect(p.positionMs(200)).toBe(300);
    const due = p.take(200);
    expect(due.map((d) => d.item.t)).toEqual([1300]);
    expect(due[0].wallT).toBe(200);
    p.setSpeed(4, 200);
    expect(p.positionMs(225)).toBe(400);
    expect(ts(p, 250)).toEqual([1500]);
  });

  it('배속을 바꾸는 순간 이미 도달한 줄을 잃지 않는다', () => {
    const p = new ReplayPlayer(tl());
    p.play(0);
    p.setSpeed(4, 150); // 100ms 줄은 도달했지만 아직 take하지 않음
    expect(ts(p, 150)).toEqual([1000, 1100]);
  });

  it('일시정지·재개: 멈춘 동안 위치가 가지 않고, 재개하면 이어진다', () => {
    const p = new ReplayPlayer(tl());
    p.play(0);
    expect(ts(p, 120)).toEqual([1000, 1100]);
    p.pause(120);
    expect(p.state).toBe('paused');
    expect(ts(p, 5000)).toEqual([]);
    expect(p.positionMs(5000)).toBe(120);
    p.play(5000);
    expect(ts(p, 5100)).toEqual([]);
    expect(ts(p, 5200)).toEqual([1300]); // 위치 300 = 120 + 180
  });

  it('일시정지 직전까지 도달한 줄은 대기열에 남아 다음 take로 나온다', () => {
    const p = new ReplayPlayer(tl());
    p.play(0);
    p.pause(150);
    expect(ts(p, 160)).toEqual([1000, 1100]);
  });

  it('처음부터: 위치 0에서 다시 모두 내보낸다. 끝난 뒤 재생해도 처음부터', () => {
    const p = new ReplayPlayer(tl());
    p.play(0);
    ts(p, 10_000);
    p.restart(20_000);
    expect(p.state).toBe('playing');
    expect(ts(p, 20_000)).toEqual([1000]);
    ts(p, 40_000);
    expect(p.state).toBe('ended');
    p.play(50_000);
    expect(ts(p, 50_000)).toEqual([1000]);
  });

  it('빈 시간표는 재생하면 바로 끝난다', () => {
    const p = new ReplayPlayer(buildTimeline({ rows: [], diags: [] }));
    p.play(0);
    expect(p.take(10)).toEqual([]);
    expect(p.state).toBe('ended');
  });
});

describe('ReplayOffsets', () => {
  const ack = (t0: number, t1Us: number, role: 0 | 1 = 0) => buildSyncAck({ role, t0Ms: t0, t1Us });

  it('SYNC 송신(t0)과 SYNC_ACK 짝으로 스틱별 오프셋을 구하고 왕복이 긴 표본은 쓰지 않는다', () => {
    const o = new ReplayOffsets();
    expect(o.offsetOf(0)).toBeNull();
    o.observe(1000, 'out', null, encodeSync(1000));
    o.observe(1020, 'in', 0, ack(1000, 400_000)); // rtt 20, offset = 1010 - 400 = 610
    expect(o.offsetOf(0)).toBe(610);
    expect(o.offsetOf(1)).toBeNull();
    o.observe(2000, 'out', null, encodeSync(2000));
    o.observe(2030, 'in', 0, ack(2000, 1_400_000)); // rtt 30(더 큼) -> 유지
    expect(o.offsetOf(0)).toBe(610);
    o.observe(3000, 'out', null, encodeSync(3000));
    o.observe(3010, 'in', 0, ack(3000, 2_400_000)); // rtt 10 -> 3005 - 2400 = 605
    expect(o.offsetOf(0)).toBe(605);
    // 1번 스틱은 같은 SYNC에 따로 짝지어진다
    o.observe(3012, 'in', 1, ack(3000, 2_400_000, 1));
    expect(o.offsetOf(1)).toBe(3006 - 2400);
  });

  it('연주 때와 같은 규칙: 옛 표본은 10초 창에서 빠지고 적용값은 초당 1ms로 따라간다', () => {
    const o = new ReplayOffsets();
    o.observe(1000, 'out', null, encodeSync(1000));
    o.observe(1004, 'in', 0, ack(1000, 400_000)); // rtt 4, offset 1002 - 400 = 602
    expect(o.offsetOf(0)).toBe(602);
    // 12초 뒤: 왕복이 더 길지만 옛 표본이 창에서 빠져 목표가 된다. 그 사이 12초라 5ms 차이를 다 따라간다
    o.observe(13_000, 'out', null, encodeSync(13_000));
    o.observe(13_010, 'in', 0, ack(13_000, 12_398_000)); // offset 13005 - 12398 = 607
    expect(o.offsetOf(0)).toBeCloseTo(607, 6);
    // 1초 뒤 목표가 10ms 바뀌어도 1ms만 움직인다
    o.observe(14_000, 'out', null, encodeSync(14_000));
    o.observe(14_010, 'in', 0, ack(14_000, 13_388_000)); // offset 14005 - 13388 = 617
    expect(o.offsetOf(0)).toBeCloseTo(608, 6);
  });

  it('페달(role 2·3) ACK는 손 오프셋에 쓰지 않는다. 이전 파일처럼 stick이 role & 1로 적혀 있어도 같다', () => {
    const o = new ReplayOffsets();
    o.observe(1000, 'out', null, encodeSync(1000));
    o.observe(1010, 'in', null, buildSyncAck({ role: 2, t0Ms: 1000, t1Us: 400_000 }));
    o.observe(1012, 'in', 1, buildSyncAck({ role: 3, t0Ms: 1000, t1Us: 400_000 }));
    expect(o.offsetOf(0)).toBeNull();
    expect(o.offsetOf(1)).toBeNull();
    // 같은 SYNC에 손은 그대로 짝지어진다
    o.observe(1020, 'in', null, ack(1000, 400_000, 1));
    expect(o.offsetOf(1)).toBe(610);
  });

  it('짝이 없는 ACK는 무시하고, 초기화하면 비운다', () => {
    const o = new ReplayOffsets();
    o.observe(100, 'in', 0, ack(777, 1000));
    expect(o.offsetOf(0)).toBeNull();
    o.observe(100, 'out', null, encodeSync(100));
    o.observe(110, 'in', 0, ack(100, 1000));
    expect(o.offsetOf(0)).not.toBeNull();
    o.reset();
    expect(o.offsetOf(0)).toBeNull();
  });
});
