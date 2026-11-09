// 라이브러리 첫 방문 안내 (Figma 210:3273 「4단계 안내」). 본문 아래 가로 4칸.
// 카드 보기 오른쪽 안내 패널(207:2650)은 팀 요청으로 없앴다(설계 QA-363-song-list-pager-studio-grid).

interface Step {
  title: string;
  desc: string;
}

const STEPS: Step[] = [
  { title: '접수', desc: '음원을 받아 작업 대기열에 올려요' },
  { title: '드럼 분리', desc: '음원에서 드럼 소리만 골라내요' },
  { title: '채보 생성', desc: '드럼 소리를 악보로 옮겨요' },
  { title: '완료', desc: '악보 연습·플레이가 열려요' },
];

export function HowtoPanel() {
  return (
    <ol className="studio-steps4" aria-label="곡이 만들어지는 순서">
      {STEPS.map((s, i) => (
        <li key={s.title} className="studio-steps4-item">
          <span className="studio-steps4-n t-display-20">{i + 1}</span>
          <span className="studio-steps4-h">{s.title}</span>
          <span className="studio-steps4-d">{s.desc}</span>
        </li>
      ))}
    </ol>
  );
}
