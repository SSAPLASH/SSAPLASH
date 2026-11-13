// 자유 연습 무대 아래 두 모서리의 글자 정보(MODE-002 설계 3장 「FreeHud 표시 규칙」).
// 왼쪽 최근 타격(패드·손·세기), 오른쪽 세션 통계(타격 수·평균 세기). 타격 구독은 페이지가 맡는다
import { PAD_META, type PadId } from '@/domain/kit/pads';

interface Props {
  /** 최근 타격 패드. 타격 전이면 undefined */
  pad?: PadId;
  /** 0 왼손, 1 오른손, null 모름(키보드·터치) */
  hand: 0 | 1 | null;
  velocity?: number;
  total: number;
  /** 평균 세기. 타격 전이면 null */
  mean: number | null;
}

const DASH = '—';

/** 손 칸 글자와 점 색 키. 스틱으로 치지 않는 패드(킥·하이햇 페달)는 「발」(D9). 손을 모르면 null */
function handOf(pad: PadId, hand: 0 | 1 | null): { text: string; dot: 'left' | 'right' | 'none' } | null {
  if (!PAD_META[pad].stick) return { text: '발', dot: 'none' };
  if (hand === 0) return { text: '왼손', dot: 'left' };
  if (hand === 1) return { text: '오른손', dot: 'right' };
  // 손을 모르는 타격(키보드·터치)은 손 칸을 비우고 세기만 보인다
  return null;
}

export function FreeHud({ pad, hand, velocity, total, mean }: Props) {
  const h = pad ? handOf(pad, hand) : null;
  const vel = velocity === undefined ? undefined : Math.round(velocity);
  return (
    <div className="free-hud">
      <div className="free-hud-last">
        <span className="free-hud-cap">최근 타격</span>
        <div className="free-hud-last-row">
          {/* 타격마다 다시 붙여 아래에서 떠오르게 한다 */}
          <b key={total} className={`free-hud-pad${pad ? ' is-pop' : ' is-nil'}`}>
            {pad ? PAD_META[pad].label : DASH}
          </b>
          {pad && (
            <span className="free-hud-meta">
              {h && <i className="free-hud-hand" data-hand={h.dot} aria-hidden="true" />}
              {h && <span>{h.text}</span>}
              <span>{h ? '· 세기' : '세기'}</span>
              <span className="free-hud-num">{vel ?? DASH}</span>
              {vel !== undefined && (
                <span className="free-hud-vbar" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, Math.max(0, (vel / 127) * 100))}%` }} />
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      <div className="free-hud-stats">
        <div>
          <span className="free-hud-cap">타격</span>
          <b key={total} className={total > 0 ? 'is-pop' : undefined}>
            {total}
            <small>회</small>
          </b>
        </div>
        <div>
          <span className="free-hud-cap">평균 세기</span>
          <b key={total} className={mean === null ? 'is-nil' : 'is-pop'}>
            {mean === null ? DASH : Math.round(mean)}
          </b>
        </div>
      </div>
    </div>
  );
}
