// 패드 이름표 알약 묶음(자유 연습 키트 가이드 MODE-002 D2·D5, 드럼 세팅 키 안내). 실물 킷 위에 덮는다.
// 이름표 자리·키는 domain/kit/kitGuide가 정하고, 여기서는 받은 값만 그린다. 켬·끔 설정은 쓰는 화면이 맡는다.
import type { CSSProperties } from 'react';
import type { PadId } from '@/domain/kit/pads';
import type { KitGuideLabel } from '@/domain/kit/kitGuide';
import './KitGuideLabels.css';

interface LabelsProps {
  labels: readonly KitGuideLabel[];
  /** 꺼져도 DOM에 남기고 투명하게 둔다(켜고 끌 때 전환) */
  visible: boolean;
  /** 패드별 타격 횟수. 바뀐 패드의 이름표가 잠깐 브랜드색으로 켜진다 */
  hitSeq?: Partial<Record<PadId, number>>;
}

/** 이름표 알약 묶음. 킷 크기 래퍼(DrumKit overlay) 안에 절대 배치하고 누름을 받지 않는다 */
export function KitGuideLabels({ labels, visible, hitSeq }: LabelsProps) {
  return (
    <div className={`free-plabels${visible ? '' : ' is-off'}`} aria-hidden="true">
      {labels.map((l, i) => {
        const seq = hitSeq?.[l.pad] ?? 0;
        return (
          <span
            // 타격마다 다시 붙여 켜짐 애니메이션을 처음부터 재생한다
            key={`${l.pad}-${seq}`}
            className={`free-plabel${seq > 0 ? ' is-hit' : ''}`}
            data-pad={l.pad}
            style={{ left: `${l.xPct}%`, top: `${l.yPct}%`, '--i': i } as CSSProperties}
          >
            {l.name}
            {l.keys.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </span>
        );
      })}
    </div>
  );
}
