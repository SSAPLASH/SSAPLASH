// 라이브러리 안내 (Figma 207:2650 「어떻게 되나요」 패널 · 210:3273 「4단계 안내」). 두 모양이 같은 4단계 문구를 쓴다.
// panel = 목록 오른쪽 300 폭 패널(번호 원 + 제목 + 설명 + 노트), steps = 첫 방문 본문 아래 가로 4칸.

interface Step {
  title: string;
  desc: string;
  /** 첫 방문 가로 4칸에서만 다른 설명 */
  descWide?: string;
}

const STEPS: Step[] = [
  { title: '접수', desc: '음원을 받아 작업 대기열에 올려요' },
  { title: '드럼 분리', desc: '음원에서 드럼 소리만 골라내요' },
  { title: '채보 생성', desc: '드럼 소리를 악보로 옮겨요' },
  { title: '완료', desc: '악보를 확인하거나 바로 플레이할 수 있어요', descWide: '악보 연습·플레이가 열려요' },
];

const NOTE = "생성은 한 번에 한 곡만 할 수 있어요. 끝나면 사이드바 '라이브러리'에 점으로 알려 드려요.";

interface Props {
  variant: 'panel' | 'steps';
}

export function HowtoPanel({ variant }: Props) {
  if (variant === 'steps') {
    return (
      <ol className="studio-steps4" aria-label="곡이 만들어지는 순서">
        {STEPS.map((s, i) => (
          <li key={s.title} className="studio-steps4-item">
            <span className="studio-steps4-n t-display-20">{i + 1}</span>
            <span className="studio-steps4-h">{s.title}</span>
            <span className="studio-steps4-d">{s.descWide ?? s.desc}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <aside className="studio-howto" aria-labelledby="studio-howto-title">
      <h3 id="studio-howto-title" className="studio-howto-title">
        어떻게 되나요
      </h3>
      <ol className="studio-howto-list">
        {STEPS.map((s, i) => (
          <li key={s.title} className="studio-howto-step">
            <span className="studio-howto-num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="studio-howto-text">
              <span className="studio-howto-h">{s.title}</span>
              <span className="studio-howto-d">{s.desc}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="studio-howto-note">{NOTE}</p>
    </aside>
  );
}
