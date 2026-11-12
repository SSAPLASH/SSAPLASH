// 전자 드럼 스킨(Figma Play / Pad Electronic). 흰 후프·검은 개스킷·메시 헤드, 심벌은 검은 고무 + 금색 테두리
import { FlatJudgeRing, FlatMotion, FlatTexts, FlatTilt, PEDAL_GROOVES, PEDAL_PLATE, onCircle, type FlatSkinProps } from './flatParts';

/** 심벌 홈 줄 지름 */
const GROOVES = [126, 112, 98, 84, 70];
/** 메시 결 동심원 반지름: 지름 114부터 8씩 줄여 18까지 */
const WEAVE = Array.from({ length: 13 }, (_, i) => (114 - i * 8) / 2);

/** 드럼·킥 몸체: 후프 + 러그 + 개스킷 + 메시 */
function MeshBody({ shape, defsId }: { shape: 'drum' | 'kick'; defsId: string }) {
  const lugs = shape === 'kick' ? 8 : 6;
  return (
    <>
      <circle className="el-hoop" cx="80" cy="80" r="76" fill={`url(#${defsId}-el-hoop)`} />
      {Array.from({ length: lugs }, (_, i) => {
        const [x, y] = onCircle(80, 80, 72, i, lugs);
        return <circle key={i} className="el-lug" cx={x.toFixed(2)} cy={y.toFixed(2)} r="2.5" fill="#6B717A" />;
      })}
      <circle cx="80" cy="80" r="68" fill="#141518" />
      <circle cx="80" cy="80" r="61" fill={`url(#${defsId}-el-mesh)`} />
      {/* 메시 안쪽 그림자 근사: 가장자리 안쪽 어두운 띠 */}
      <circle cx="80" cy="80" r="59" fill="none" stroke="#000" strokeOpacity="0.3" strokeWidth="4" />
      {WEAVE.map((r) => (
        <circle key={r} cx="80" cy="80" r={r} fill="none" stroke="#fff" strokeOpacity="0.05" strokeWidth="0.75" />
      ))}
      {shape === 'kick' && (
        <circle className="el-beater" cx="80" cy="80" r="27" fill="#fff" fillOpacity="0.06" stroke="#fff" strokeOpacity="0.06" />
      )}
    </>
  );
}

/** 심벌 몸체: 금색 테두리 + 검은 고무 + 홈 + 벨 + 볼트 */
function CymbalBody({ defsId }: { defsId: string }) {
  return (
    <>
      <circle className="el-hoop" cx="80" cy="80" r="76" fill={`url(#${defsId}-el-edge)`} />
      <circle cx="80" cy="80" r="69" fill={`url(#${defsId}-el-rubber)`} />
      {GROOVES.map((d) => (
        <circle key={d} cx="80" cy="80" r={d / 2} fill="none" stroke="#fff" strokeOpacity="0.06" />
      ))}
      <circle cx="80" cy="80" r="23" fill={`url(#${defsId}-el-bell)`} stroke="#3E4247" />
      <circle cx="80" cy="80" r="6" fill={`url(#${defsId}-el-bolt)`} />
    </>
  );
}

/** 하이햇 페달: 흰 테 발판 + 검은 고무 + 가로 홈 */
function PedalBody({ defsId }: { defsId: string }) {
  return (
    <>
      <path className="el-hoop" d={PEDAL_PLATE} fill={`url(#${defsId}-el-hoop)`} />
      <path d={PEDAL_PLATE} transform="translate(80 81) scale(0.84 0.88) translate(-80 -81)" fill={`url(#${defsId}-el-rubber)`} />
      {PEDAL_GROOVES.map((y) => (
        <line key={y} x1="58" y1={y} x2="102" y2={y} stroke="#fff" strokeOpacity="0.08" strokeWidth="2" />
      ))}
    </>
  );
}

export function ElectronicPad({ shape, state, defsId, tag, label, labelVisible, hitKey, tilt }: FlatSkinProps) {
  if (shape === 'pedal') {
    const lit = state === 'hit' || state === 'armed';
    return (
      <>
        <FlatTilt tilt={tilt}>
          <FlatMotion shape={shape} state={state} hitKey={hitKey}>
            <PedalBody defsId={defsId} />
            {state === 'hit' && <path className="drum-pad-flash el-flash" d={PEDAL_PLATE} />}
            {lit && <path className="drum-pad-led" d={PEDAL_PLATE} strokeWidth={state === 'armed' ? 2.5 : 4} />}
          </FlatMotion>
        </FlatTilt>
        <FlatTexts shape={shape} state={state} tag={tag} label={label} labelVisible={labelVisible} tagTop={140} />
      </>
    );
  }
  const cymbal = shape === 'cymbal';
  // 플래시·LED 지름: drum·kick은 메시/개스킷, cymbal은 고무 원판 기준
  const flashR = cymbal ? 69 : 61;
  const ledR = cymbal ? 69 : 68;
  const ledW = state === 'armed' ? 2.5 : 4;
  const led = state === 'hit' || state === 'armed';
  return (
    <>
      <FlatTilt tilt={tilt}>
        <FlatMotion shape={shape} state={state} hitKey={hitKey}>
          {cymbal ? <CymbalBody defsId={defsId} /> : <MeshBody shape={shape} defsId={defsId} />}
          {state === 'hit' && <circle className="drum-pad-flash el-flash" cx="80" cy="80" r={flashR} />}
          {led && <circle className="drum-pad-led" cx="80" cy="80" r={ledR - ledW / 2} strokeWidth={ledW} />}
        </FlatMotion>
        <FlatJudgeRing state={state} />
      </FlatTilt>
      <FlatTexts shape={shape} state={state} tag={tag} label={label} labelVisible={labelVisible} tagTop={cymbal ? 106 : 63} />
    </>
  );
}
