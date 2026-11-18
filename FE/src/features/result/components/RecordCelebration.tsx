// 최고 기록 갱신 축하(결과 화면 전체). 색종이(domain/confetti)가 화면 전체에 터져 팔랑팔랑 떨어지고, 가운데에 네온사인 글자 「NEW BEST · 최고 기록 갱신」이 깜빡이며 켜졌다가 꺼진다(카드·테두리 없음).
// 카드·본문의 overflow·transform에 잘리지 않도록 body에 올린다. 클릭을 막지 않고, 다 끝나면 스스로 내려간다(rAF 정지).
// 조건 판단(갱신일 때만·도착 1회만·모션 줄이기 제외)은 ResultPage가 한다.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CONFETTI_END_MS, confettiAt, createConfetti, type ConfettiPiece } from '@/features/result/domain/confetti';
import './record-celebration.css';

/** 가운데 글이 떠 있는 시간(ms). CSS 애니메이션 길이와 같다 */
export const RECORD_TEXT_MS = 3000;
const DONE_MS = Math.max(CONFETTI_END_MS, RECORD_TEXT_MS) + 100;

export interface RecordCelebrationProps {
  /** 글 아래 한 줄(예: 「이전 1,200 → 현재 1,310」). 없으면 그리지 않는다 */
  detail?: string;
  /** 색종이 모양을 정하는 값(같으면 같은 모양) */
  seq?: number;
  onDone?: () => void;
}

function drawPiece(ctx: CanvasRenderingContext2D, p: ConfettiPiece, tMs: number) {
  const pose = confettiAt(p, tMs);
  if (!pose) return;
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.rot);
  // 종이가 뒤집히는 모습: 세로로 납작해졌다 펴진다. 뒷면은 조금 어둡게
  ctx.scale(1, Math.max(0.12, Math.abs(pose.flip)));
  ctx.globalAlpha = pose.alpha * (pose.flip < 0 ? 0.72 : 1);
  ctx.fillStyle = p.color;
  ctx.beginPath();
  if (p.shape === 'circle') ctx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
  else ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, p.shape === 'ribbon' ? 2 : 1.5);
  ctx.fill();
  ctx.restore();
}

export function RecordCelebration({ detail, seq = 1, onDone }: RecordCelebrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [done, setDone] = useState(false);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    let raf = 0;
    if (canvas && ctx) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const pieces = createConfetti(seq, w, h);
      const start = performance.now();
      const draw = () => {
        const t = performance.now() - start;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        for (const p of pieces) drawPiece(ctx, p, t);
        if (t < CONFETTI_END_MS) raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    }
    const timer = window.setTimeout(() => {
      setDone(true);
      doneRef.current?.();
    }, DONE_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [seq]);

  if (done) return null;
  return createPortal(
    <div className="record-celebrate" aria-hidden="true">
      <canvas ref={canvasRef} className="record-celebrate-canvas" />
      <div className="record-celebrate-text">
        <span className="record-celebrate-eyebrow">NEW BEST</span>
        <strong className="record-celebrate-title">최고 기록 갱신</strong>
        {detail && <span className="record-celebrate-detail">{detail}</span>}
      </div>
    </div>,
    document.body,
  );
}
