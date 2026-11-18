// 제목 옆 「재생 중」 이퀄라이저 (Figma 시안 「자유 연습 · 반주 바 — D · 음악 앱 스타일」 eq 971:50985 · 일시정지 971:51089).
// 막대 3개(폭 3px, 간격 2px). 재생 중이면 브랜드색으로 오르내리고, 멈추면 납작한 회색 점 3개가 된다.
// 움직임 줄이기 설정이면 시안의 고정 높이(8·14·10px)로 멈춰 있다.
import './song.css';

interface Props {
  /** 참이면 움직인다(소리가 나는 중). 거짓이면 납작한 회색 */
  playing: boolean;
}

export function PlayingEq({ playing }: Props) {
  return (
    <span className={`song-eq ${playing ? 'is-playing' : 'is-paused'}`} role="img" aria-label={playing ? '재생 중' : '일시정지'}>
      <span className="song-eq-bar" />
      <span className="song-eq-bar" />
      <span className="song-eq-bar" />
    </span>
  );
}
