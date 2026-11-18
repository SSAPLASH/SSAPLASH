// 패드 소리 on/off 스위치(아이콘 버튼 32×32 + 툴팁). 메트로놈 클릭은 영향 없음(패드 버스만 음소거).
import { SoundIcon } from '@/components/shell/dock/SoundIcon';
import { IconButton } from '@/components/ui/action/IconButton';
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
      <SoundIcon on={soundOn} />
    </IconButton>
  );
}
