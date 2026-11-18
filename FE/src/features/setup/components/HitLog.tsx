// 세팅 「타격 확인」 최근 타격 표(Figma 254:8004). 패드·세기·시각 최대 5행, 새 타격이 위(손 열은 뺐다: SETUP-fixed-kit-noir D3). 표시 전용 —
// 구독은 useRecentHits가 하고 이 컴포넌트는 받은 행만 그린다.
import { PAD_META } from '@/domain/kit/pads';
import type { RecentHit } from '@/components/drum/useRecentHits';
import { HIT_LOG_ROWS, hitAgoText } from './hitLogFormat';
import './setup.css';

interface Props {
  hits: RecentHit[];
  /** 경과 문구 기준 시각(Date.now). 호출자가 1초마다 갱신한다 */
  now: number;
  /** 보일 최대 행 수(기본 HIT_LOG_ROWS). 무대 위 떠 있는 카드는 CSS가 HIT_LOG_FLOAT_ROWS행만 보인다 */
  rows?: number;
}

export function HitLog({ hits, now, rows: maxRows = HIT_LOG_ROWS }: Props) {
  const rows = hits.slice(0, maxRows);
  return (
    <div className="setup-hitlog">
      <div className="setup-hitlog-row head" aria-hidden="true">
        <span>패드</span>
        <span>세기</span>
        <span>시각</span>
      </div>
      {rows.length === 0 ? (
        <p className="setup-hitlog-empty">패드를 치면 여기에 기록돼요</p>
      ) : (
        <ul className="setup-hitlog-list">
          {rows.map((h) => (
            <li key={h.id} className="setup-hitlog-row">
              <span>{h.pad ? PAD_META[h.pad].label : '판정 없음'}</span>
              <span className="setup-hitlog-num">{Math.round(h.velocity)}</span>
              <span className="setup-hitlog-ago">{hitAgoText(h.at, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
