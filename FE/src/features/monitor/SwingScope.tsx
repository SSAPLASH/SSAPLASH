// 원시 파형 탭: SWING 청크로 조립한 스윙 구간의 가속도·자이로 파형과 같은 hitSeq의 HIT 정보를 보여 준다(설계 3-8 c).
// 규격은 EMB 회신 3(2026-10-26): 844Hz·1.18ms 간격, 단위는 펌웨어 변환값(가속도 mg, 자이로 °/s). 청크 1개 = 샘플 1개라
// 누락 음영은 연속된 누락 샘플을 한 구간으로 병합해 그린다. 판정 경로와 무관한 모니터 전용 화면이다.
import { memo, useEffect, useState } from 'react';
import { useRef } from 'react';
import { encodeSetMode, StreamMode, type DecodedHit } from '@/input/stickProtocol';
import type { LogRow } from '@/features/monitor/core/recording/packetLog';
import { toSeries, type SwingAssembler, type SwingRecord } from '@/features/monitor/core/swingAssembler';
import { cssVar, fmt, prepareCanvas, stickName, type SendFn } from './monitorTypes';

/** 판정 시각은 정지보다 중앙값 14ms 앞(원문 7장) */
const JUDGE_LEAD_MS = 14;
/** 감속 구간 길이(정지 직전, ms) */
const DECEL_MS = 20;
/** 가로 눈금 간격(ms) */
const TICK_MS = 50;
/** 세로 축 라벨 폭(px) */
const LEFT_PAD = 52;
const GRAY = '#8a93a8';

/** 같은 스틱·hitSeq의 가장 최근 HIT. 없으면 null */
function findHit(rows: readonly LogRow[], rec: SwingRecord): DecodedHit | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const d = r.decoded;
    if (r.dir === 'in' && d?.kind === 'hit' && r.stick === rec.stick && d.seq === rec.hitSeq) return d;
  }
  return null;
}

function statusText(rec: SwingRecord): string {
  if (rec.complete) return '완성';
  if (rec.timedOut) {
    // 청크 1개 = 샘플 1개면 샘플 단위로, 아니면 청크 단위로 표기
    const unit = rec.chunkCount > 0 && rec.sampleCount === rec.chunkCount ? '샘플' : '청크';
    return `불완전 ${rec.missing.length}${unit} 누락`;
  }
  return '대기 중';
}

interface PlotOpts {
  series: { data: Float32Array; color: string }[];
  tMs: Float32Array;
  unit: string;
  /** 누락 청크가 덮는 시간(ms) 구간(연속 누락은 한 구간으로 병합) */
  missingRanges: [number, number][];
  /** 위 단(가속도)이면 판정선·감속 구간, 아래 단(자이로)이면 peakSpeed 마커 */
  upper: boolean;
  hit: DecodedHit | null;
}

function plot(canvas: HTMLCanvasElement | null, o: PlotOpts): void {
  const c = prepareCanvas(canvas);
  if (!c || !canvas) return;
  const { ctx, w, h } = c;
  const line = cssVar(canvas, '--line', '#34405c');
  const faint = cssVar(canvas, '--text-3', '#6e778d');
  const brass = cssVar(canvas, '--brand', '#e6b85c');
  const miss = cssVar(canvas, '--miss', '#e05a5a');
  const n = o.tMs.length;
  const top = 8;
  const bottom = 18;
  const pw = w - LEFT_PAD - 8;
  const ph = h - top - bottom;
  // 가로축: 첫 샘플(음수)~0ms
  const t0 = n > 0 ? Math.min(o.tMs[0], -1) : -1;
  const px = (t: number) => LEFT_PAD + ((t - t0) / (0 - t0)) * pw;
  let max = 1;
  for (const s of o.series) for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(s.data[i]));
  const py = (v: number) => top + ph / 2 - (v / max) * (ph / 2);

  // 누락 청크 음영
  ctx.fillStyle = GRAY;
  ctx.globalAlpha = 0.25;
  for (const [a, b] of o.missingRanges) ctx.fillRect(px(a), top, Math.max(1, px(b) - px(a)), ph);
  ctx.globalAlpha = 1;

  // 감속 구간(마지막 20ms) 음영
  if (o.upper) {
    ctx.fillStyle = miss;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(px(-DECEL_MS), top, px(0) - px(-DECEL_MS), ph);
    ctx.globalAlpha = 1;
  }

  // 테두리·0선·가로 눈금
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.strokeRect(LEFT_PAD + 0.5, top + 0.5, pw, ph);
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(LEFT_PAD, py(0));
  ctx.lineTo(LEFT_PAD + pw, py(0));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = '10px monospace';
  ctx.fillStyle = faint;
  ctx.textAlign = 'center';
  for (let t = 0; t >= t0; t -= TICK_MS) {
    const x = px(t);
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + ph);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(`${t}`, x, h - 5);
  }
  ctx.textAlign = 'right';
  ctx.fillText(`+${max.toFixed(0)}`, LEFT_PAD - 4, top + 9);
  ctx.fillText('0', LEFT_PAD - 4, py(0) + 3);
  ctx.fillText(`−${max.toFixed(0)}`, LEFT_PAD - 4, top + ph);
  ctx.save();
  ctx.translate(10, top + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(o.unit, 0, 0);
  ctx.restore();
  ctx.textAlign = 'start';

  // 파형
  for (const s of o.series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = px(o.tMs[i]);
      if (i === 0) ctx.moveTo(x, py(s.data[i]));
      else ctx.lineTo(x, py(s.data[i]));
    }
    ctx.stroke();
  }

  if (o.upper) {
    // 판정 시각(정지보다 14ms 앞) 점선
    ctx.strokeStyle = brass;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px(-JUDGE_LEAD_MS), top);
    ctx.lineTo(px(-JUDGE_LEAD_MS), top + ph);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = brass;
    ctx.textAlign = 'right';
    ctx.fillText('판정(중앙값)', px(-JUDGE_LEAD_MS) - 3, top + 10);
    ctx.fillStyle = miss;
    ctx.fillText('감속 구간', px(0) - 3, top + ph - 4);
    ctx.textAlign = 'start';
  }
  // 오른쪽 끝 = 추정 정지 시각(HIT timestampUs)
  ctx.strokeStyle = cssVar(canvas, '--text-1', '#e8e4da');
  ctx.beginPath();
  ctx.moveTo(px(0) - 0.5, top);
  ctx.lineTo(px(0) - 0.5, top + ph);
  ctx.stroke();

  if (!o.upper && o.hit && n > 0) {
    // gx 절댓값 최대 지점에 peakSpeed 마커
    const gx = o.series[0].data;
    let bi = 0;
    for (let i = 1; i < n; i++) if (Math.abs(gx[i]) > Math.abs(gx[bi])) bi = i;
    ctx.fillStyle = cssVar(canvas, '--perfect', '#f0d060');
    ctx.beginPath();
    ctx.arc(px(o.tMs[bi]), py(gx[bi]), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(`peakSpeed ${o.hit.peakSpeedDps}`, Math.min(px(o.tMs[bi]) + 6, LEFT_PAD + pw - 90), py(gx[bi]) - 6);
  }
}

interface Props {
  assembler: SwingAssembler;
  /** 조립기 version. 바뀔 때만 다시 그린다 */
  version: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  send: SendFn;
  canSend: boolean;
  /** HIT 짝짓기용 로그 행 */
  rows: readonly LogRow[];
}

export const SwingScope = memo(function SwingScope({ assembler, version, selectedKey, onSelect, send, canSend, rows }: Props) {
  const accRef = useRef<HTMLCanvasElement>(null);
  const gyroRef = useRef<HTMLCanvasElement>(null);
  const [lastMode, setLastMode] = useState<number | null>(null);

  const list = assembler.list();
  // 선택이 없거나 이미 밀려난 키면 최신 것을 보여 준다
  const rec = (selectedKey ? assembler.get(selectedKey) : undefined) ?? list[0] ?? null;
  const hit = rec ? findHit(rows, rec) : null;

  const setMode = (mode: number) => {
    send(encodeSetMode(mode));
    setLastMode(mode);
  };

  // version·선택 변화 때만 rAF 한 번으로 다시 그린다(HIT가 늦게 도착하면 hit 유무 변화로도 그린다).
  // 조립기 레코드는 제자리에서 바뀌므로 rec 객체 대신 version으로 갱신 여부를 판단한다
  // 그리는 시점의 최신 rows를 effect 의존성 없이 읽기 위한 ref(그리기 effect보다 먼저 갱신)
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });
  const recKey = rec?.key ?? null;
  const hasHit = hit !== null;
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const target = recKey ? assembler.get(recKey) : undefined;
      const empty = new Float32Array(0);
      const s = target ? toSeries(target) : null;
      const n = target?.sampleCount ?? 0;
      const spc = target && target.chunkCount > 0 ? n / target.chunkCount : 0;
      // 누락 청크가 덮는 샘플 구간 → 시간(ms) 구간. 마지막 샘플이 0ms
      const missingRanges: [number, number][] = [];
      if (target && s && n > 0) {
        // missing은 오름차순 chunkIdx. 이어지는 청크는 한 구간으로 합친다
        let runStart = -1;
        let prev = -2;
        const flush = () => {
          if (runStart < 0) return;
          missingRanges.push([
            s.tMs[Math.min(n - 1, Math.floor(runStart * spc))],
            s.tMs[Math.min(n - 1, Math.ceil((prev + 1) * spc) - 1)],
          ]);
        };
        for (const c of target.missing) {
          if (c !== prev + 1) {
            flush();
            runStart = c;
          }
          prev = c;
        }
        flush();
      }
      const tMs = s?.tMs ?? empty;
      const base = accRef.current ?? document.body;
      const cA = cssVar(base, '--miss', '#e05a5a');
      const cB = cssVar(base, '--good', '#5fb8ae');
      const cC = cssVar(base, '--left', '#7cc4ff');
      const curHit = target ? findHit(rowsRef.current, target) : null;
      plot(accRef.current, {
        series: [
          { data: s?.ax ?? empty, color: cA },
          { data: s?.ay ?? empty, color: cB },
          { data: s?.az ?? empty, color: cC },
        ],
        tMs,
        unit: 'mg',
        missingRanges,
        upper: true,
        hit: curHit,
      });
      plot(gyroRef.current, {
        series: [
          { data: s?.gx ?? empty, color: cA },
          { data: s?.gy ?? empty, color: cB },
          { data: s?.gz ?? empty, color: cC },
        ],
        tMs,
        unit: '°/s',
        missingRanges,
        upper: false,
        hit: curHit,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [assembler, version, recKey, hasHit]);

  return (
    <div className="mon-swing-wrap">
      <div className="mon-summary-line">
        SWING은 SET_MODE 2(데이터 수집)에서만 옵니다
        <span className="mon-swing-modes">
          <button className="btn-ghost small" disabled={!canSend} onClick={() => setMode(StreamMode.RAW_COLLECT)}>
            데이터 수집 모드로
          </button>
          <button className="btn-ghost small" disabled={!canSend} onClick={() => setMode(StreamMode.HIT_AND_POSE)}>
            설정 모드로
          </button>
          <button className="btn-ghost small" disabled={!canSend} onClick={() => setMode(StreamMode.HIT_ONLY)}>
            연주 모드로
          </button>
          <span className="faint small">마지막 송신: {lastMode ?? '–'}</span>
        </span>
      </div>
      <div className="mon-swing">
        <div className="mon-swing-list">
          {list.length === 0 && <p className="faint mon-empty">스윙이 아직 없습니다. 데이터 수집 모드에서 스틱을 치세요.</p>}
          {list.map((r) => (
            <button
              key={r.key}
              className={`mon-swing-item${rec?.key === r.key ? ' active' : ''}`}
              onClick={() => onSelect(r.key)}
            >
              <strong style={{ color: r.stick === 0 ? 'var(--left)' : 'var(--right)' }}>{stickName(r.stick)}</strong>
              <span className="num">#{r.hitSeq}</span>
              <span className="num">{r.sampleCount}샘플</span>
              <span className={r.complete ? 'ok' : r.timedOut ? 'bad' : 'faint'}>{statusText(r)}</span>
            </button>
          ))}
        </div>
        <div className="mon-swing-main">
          {rec ? (
            <>
              <div className="mon-summary-line">
                {stickName(rec.stick)} #{rec.hitSeq} ·{' '}
                {hit ? (
                  <>
                    pad {hit.pad ?? '없음'} · velocity {hit.velocity} · margin {fmt(hit.marginDeg)}° · peakSpeed {hit.peakSpeedDps} ·
                    decel {fmt(hit.decel)} · timestampUs {hit.timestampUs}
                  </>
                ) : (
                  <span className="faint">HIT 미수신</span>
                )}
              </div>
              <div className="faint small">
                가로: 정지(0ms, HIT timestampUs 추정) 기준 ms · 회색 음영 = 누락 샘플(연속 구간은 하나로) · 844Hz · 1.18ms 간격 · 단위는 펌웨어 변환값(EMB 회신 3) · 위 ax(빨강) ay(청록) az(파랑),
                아래 gx gy gz 같은 색
              </div>
            </>
          ) : (
            <div className="faint">선택된 스윙이 없습니다.</div>
          )}
          <canvas ref={accRef} className="mon-swing-cv" />
          <canvas ref={gyroRef} className="mon-swing-cv" />
        </div>
      </div>
    </div>
  );
});
