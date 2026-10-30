// 패드 소리 on/off 스위치. 메트로놈 클릭은 영향 없음(패드 버스만 음소거).
import { useSettings } from '@/store/settingsStore';

export function SoundToggle() {
  const soundOn = useSettings((s) => s.soundOn);
  const setSoundOn = useSettings((s) => s.setSoundOn);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={soundOn}
      aria-label="패드 소리"
      className={`sound-toggle${soundOn ? ' on' : ''}`}
      onClick={() => setSoundOn(!soundOn)}
    >
      <span className="sound-icon" aria-hidden="true" />
      패드 소리
    </button>
  );
}
