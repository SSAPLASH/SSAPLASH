// 네온 스킨(Figma Play / Pad Neon). 검은 원판 + 네온 림 + HUD 눈금. 색은 CSS 변수 --neon(모양별)
import { FlatJudgeRing, FlatMotion, FlatTexts, FlatTilt, PEDAL_GROOVES, PEDAL_PLATE, type FlatSkinProps } from './flatParts';

/** 심벌 광택 부채꼴(원뿔 그라디언트 근사): 골드·시안을 번갈아, 중심 (80,80) 반지름 70 */
function sector(from: number, to: number): string {
  const pt = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return `${(80 + 70 * Math.cos(r)).toFixed(1)},${(80 + 70 * Math.sin(r)).toFixed(1)}`;
  };
  return `M80,80 L${pt(from)} A70,70 0 0 1 ${pt(to)} Z`;
}
const GLINTS = Array.from({ length: 8 }, (_, i) => ({
  d: sector(i * 45 - 12, i * 45 + 12),
  // 짝수 = 골드, 홀수 = 시안
  fill: i % 2 === 0 ? '#FFC24A' : '#22E4FF',
  // Figma의 은은한 angular 광택에 맞춰 옅게(진하면 바람개비처럼 보인다)
  opacity: i % 2 === 0 ? 0.14 : 0.07,
}));

export function NeonPad({ shape, state, tag, label, labelVisible, hitKey, tilt }: FlatSkinProps) {
  if (shape === 'pedal') {
    // 하이햇 페달: 검은 발판 + 네온 테 + 가로 눈금
    const w = state === 'idle' ? 2.5 : state === 'armed' ? 3.5 : 4;
    return (
      <>
        <FlatTilt tilt={tilt}>
          <FlatMotion shape={shape} state={state} hitKey={hitKey}>
            <path className="neon-body" d={PEDAL_PLATE} fill="#05070D" />
            {PEDAL_GROOVES.map((y) => (
              <line key={y} className="neon-cross" x1="58" y1={y} x2="102" y2={y} />
            ))}
            {state === 'hit' && <path className="drum-pad-flash neon-flash" d={PEDAL_PLATE} />}
            <path className="neon-rim" d={PEDAL_PLATE} strokeWidth={w} />
          </FlatMotion>
        </FlatTilt>
        <FlatTexts shape={shape} state={state} tag={tag} label={label} labelVisible={labelVisible} tagTop={140} />
      </>
    );
  }
  const cymbal = shape === 'cymbal';
  const hit = state === 'hit';
  const rimW = state === 'idle' ? 2.5 : state === 'armed' ? 3.5 : 4;
  return (
    <>
      <FlatTilt tilt={tilt}>
      <FlatMotion shape={shape} state={state} hitKey={hitKey}>
        <circle className="neon-ticks" cx="80" cy="80" r="77" fill="none" strokeWidth="2" strokeDasharray="2 9" />
        <circle className="neon-body" cx="80" cy="80" r="72" fill="#05070D" />
        {!cymbal && (
          <>
            <line className="neon-cross" x1="24" y1="80" x2="136" y2="80" />
            <line className="neon-cross" x1="80" y1="24" x2="80" y2="136" />
          </>
        )}
        {cymbal &&
          GLINTS.map((g, i) => <path key={i} d={g.d} fill={g.fill} fillOpacity={g.opacity} />)}
        {cymbal && <circle className="neon-bell" cx="80" cy="80" r="11" />}
        {shape === 'kick' && (
          <circle className="neon-port" cx="80" cy="122" r="14" fill="#05070E" strokeWidth="1.5" opacity="0.9" />
        )}
        {hit && <circle className="drum-pad-flash neon-flash" cx="80" cy="80" r="72" />}
        <circle className="neon-rim" cx="80" cy="80" r={72 - rimW / 2} strokeWidth={rimW} />
      </FlatMotion>
      {/* 판정 링은 perfect/good/miss에만 나오므로 hit에서는 네온 림만 보인다 */}
      <FlatJudgeRing state={state} />
      </FlatTilt>
      <FlatTexts shape={shape} state={state} tag={tag} label={label} labelVisible={labelVisible} tagTop={cymbal ? 94 : 63} />
    </>
  );
}
