// 「오디오 준비 중…」 안내 (설계 MODE-001 오디오 시계 시작 대기 D7). 시작·재개 전에 오디오 시계를 기다리는 시간이 길어질 때만 보인다.
import '../play.css';

export function AudioWaitNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="audio-wait-notice" role="status">
      오디오 준비 중…
    </p>
  );
}
