// 스크롤 안내: 데스크톱은 마우스 휠, 터치 기기는 화살표만(CSS 미디어 쿼리로 전환).
import { CUE_LABEL } from './landingContent';

export function ScrollCue({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="lp-scroll-cue" aria-label={CUE_LABEL.aria} onClick={onClick}>
      <span className="lp-cue-mouse" aria-hidden="true" />
      <span>
        <span className="lp-cue-desk">{CUE_LABEL.desktop}</span>
        <span className="lp-cue-touch">{CUE_LABEL.touch}</span>
      </span>
      <span className="lp-cue-arrows" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </button>
  );
}
