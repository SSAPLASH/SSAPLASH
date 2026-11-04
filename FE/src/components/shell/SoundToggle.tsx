// 패드 소리 on/off 스위치(아이콘 버튼 32×32 + 툴팁). 메트로놈 클릭은 영향 없음(패드 버스만 음소거).
import { IconButton } from '@/components/ui/IconButton';
import { useSettings } from '@/store/settingsStore';

export function SoundToggle() {
  const soundOn = useSettings((s) => s.soundOn);
  const setSoundOn = useSettings((s) => s.setSoundOn);
  const label = soundOn ? '패드 소리 켜짐' : '패드 소리 꺼짐';
  return (
    <IconButton
      size="sm"
      role="switch"
      aria-checked={soundOn}
      label="패드 소리"
      title={label}
      className={`sound-toggle${soundOn ? ' on' : ''}`}
      onClick={() => setSoundOn(!soundOn)}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9v6h4l5 4V5L8 9z" />
        {soundOn ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <path d="M17 9l5 6M22 9l-5 6" />}
      </svg>
    </IconButton>
  );
}
