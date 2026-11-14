// Figma 228:5712 메트로놈 패널 — Dock 칩 아래 360 팝오버. 제목 + 박 무늬 · 박자·탭 템포 · 박 분할 · 메트로놈 음량.
// 켜기 스위치와 BPM −/+는 바로 위 Dock 칩에만 있다(설계 MODE-002-MODE-003-metronome-subdivision D17) — 패널에는 Dock에 없는 것만 둔다.
// 값의 주인은 engine/Metronome(조작은 엔진 메서드), 화면 값은 liveStore.metronome, 박 분할·음량은 settingsStore.
// 열림·바깥 클릭·Esc·포커스 복귀는 GlassDock의 Radix Popover가 맡는다 — 이 컴포넌트는 Popover.Content 안 본문만 그린다. 연주는 멈추지 않는다.
import { resolveSubdivision, type BeatsPerBar, type Subdivision, type SubdivisionPref } from '@/domain/time/metronome';
import { metronome } from '@/engine/Metronome';
import { metronomePreview } from '@/runtime/metronomePreview';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { SubdivisionPicker } from '@/components/metronome/SubdivisionPicker';
import { Button } from '@/components/ui/action/Button';
import { Segmented } from '@/components/ui/form/Segmented';
import { Slider } from '@/components/ui/form/Slider';
import './metronome-panel.css';

const BEAT_OPTIONS = [
  { value: '4', label: '4/4' },
  { value: '3', label: '3/4' },
];

/** gameDisabled: 리듬 게임 — 메트로놈을 쓰지 않으므로 박자·탭·박 분할을 모두 비활성으로 둔다(설계 MODE-001-play-quick-start E1) */
export function MetronomePanel({ gameDisabled = false }: { gameDisabled?: boolean }) {
  const m = useLive((s) => s.metronome);
  const pref = useSettings((s) => s.metronomeSubdivision);
  const setPref = useSettings((s) => s.setMetronomeSubdivision);
  const volume = useSettings((s) => s.metronomeVolume);
  const setVolume = useSettings((s) => s.setMetronomeVolume);

  const locked = m.locked || gameDisabled;
  // 자동은 잠금 중이면 곡 BPM, 아니면 메트로놈 BPM으로 푼다(표시는 반올림하지만 판정은 원래 값)
  const subdivision = resolveSubdivision(pref, m.bpm);

  const onPick = (v: SubdivisionPref) => {
    setPref(v);
    // 메트로놈이 울리는 중·곡 중이면 예시 소리는 나지 않는다(runtime이 거른다) — 바뀐 소리가 바로 들린다
    void metronomePreview.play('dock', m.bpm, resolveSubdivision(v, m.bpm));
  };

  return (
    <div className="metro-panel">
      <div className="metro-panel-head">
        <h2 className="metro-panel-title">메트로놈</h2>
        <BeatPattern beats={m.beatsPerBar} subdivision={subdivision} active={gameDisabled ? -1 : m.beat} />
      </div>

      <section className="metro-panel-sec metro-panel-sec-inline">
        <span className="metro-panel-label">박자</span>
        <div className="metro-panel-row">
          <Segmented
            label="박자"
            className={locked ? 'metro-panel-seg disabled' : 'metro-panel-seg'}
            options={BEAT_OPTIONS}
            value={String(m.beatsPerBar)}
            onChange={(v) => {
              if (!locked) metronome.setBeatsPerBar(Number(v) as BeatsPerBar);
            }}
          />
          <Button variant="secondary" size="sm" disabled={locked} onClick={() => metronome.tap()}>
            탭 템포
          </Button>
        </div>
        {gameDisabled ? (
          <p className="metro-panel-note">리듬 게임에서는 메트로놈을 쓰지 않아요</p>
        ) : (
          m.locked && <p className="metro-panel-note">곡 연주 중에는 곡의 BPM·박자로 고정돼요</p>
        )}
      </section>

      <section className="metro-panel-sec">
        <span className="metro-panel-label">박 분할</span>
        <SubdivisionPicker
          value={pref}
          onChange={onPick}
          bpm={m.bpm}
          place={m.locked ? 'song' : 'metronome'}
          previewPlace="dock"
          disabled={gameDisabled}
        />
      </section>

      <section className="metro-panel-sec">
        <Slider
          className="metro-panel-volume"
          label="메트로놈 음량"
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          valueText={`${Math.round(volume * 100)}%`}
          onChange={(v) => setVolume(v / 100)}
        />
      </section>
    </div>
  );
}

/**
 * 박 무늬: 한 마디에 클릭이 나는 자리. 큰 점 = 정박(첫 박은 조금 더 크다), 작은 점 = 사이 박(8분 분할).
 * 울릴 때는 정박만 켜진다 — 박 표시는 4분음표 그대로다(D5)
 */
function BeatPattern({ beats, subdivision, active }: { beats: number; subdivision: Subdivision; active: number }) {
  const pips = [];
  for (let b = 0; b < beats; b++) {
    pips.push(<i key={`b${b}`} className={`metro-pip beat${b === 0 ? ' first' : ''}${b === active ? ' on' : ''}`} />);
    if (subdivision === 2) pips.push(<i key={`s${b}`} className="metro-pip sub" />);
  }
  return (
    <span className="metro-panel-pattern" data-beats={beats} data-subdivision={subdivision} aria-hidden="true">
      {pips}
    </span>
  );
}
