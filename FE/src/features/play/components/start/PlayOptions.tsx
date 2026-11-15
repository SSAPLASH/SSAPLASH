// 연주 옵션 줄 목록 (설계 MODE-001-MODE-003-picker-quick-start · MODE-002-MODE-003-metronome-subdivision, Figma 905:4457 「연주 옵션」).
// 상자 없이 가는 선으로 나눈 스위치 줄이다 — 감싸는 쪽(시작 확인 창 등)이 제목·여백을 정한다. 보일 줄은 `rows`로 고른다(리듬 게임 재활용 대비).
// 줄 어디를 눌러도 그 줄의 스위치가 바뀐다. 메트로놈을 켜면 그 아래 박 분할 선택(자동·4분·8분)이 펼쳐진다.
// 반주가 꺼져 있거나 없는 곡이면 반주 줄 아래에 연습 속도(50~100 %, −/+ 5 % 단위)가 펼쳐진다(설계 MODE-003-practice-speed).
// 메트로놈·박 분할·패드 번호·반주·연습 속도는 props만 받고(설정 스토어 연결·예시 소리는 페이지), 녹음 줄만 녹음 스토어의 arm(`toggleArm`)을 직접 쓴다.
import { RECORDING_ENABLED } from '@/config/features';
import { toggleArm, useRecordingStore } from '@/runtime/recordingStore';
import { SubdivisionPicker } from '@/components/metronome/SubdivisionPicker';
import { Toggle } from '@/components/ui/form/Toggle';
import { accompanimentOptionText, type AccompanimentStatus } from '@/domain/song/songCatalog';
import { RATE_MAX, RATE_MIN, rateHint, rateLabel, stepRate } from '@/domain/song/practiceRate';
import type { SubdivisionPref } from '@/domain/time/metronome';
import './play-options.css';

export type PlayOptionRow = 'metronome' | 'padCount' | 'accompaniment' | 'recording';

/** 악보 연습이 보이는 줄 전부 */
export const ALL_PLAY_OPTION_ROWS: readonly PlayOptionRow[] = ['metronome', 'padCount', 'accompaniment', 'recording'];

interface Props {
  /** 보일 줄. 기본은 네 줄 전부 */
  rows?: readonly PlayOptionRow[];
  /** 곡 중 메트로놈 클릭 켬·끔 */
  metronome?: boolean;
  onMetronome?: (v: boolean) => void;
  /** 박 분할(자동·4분·8분). onSubdivision이 있을 때만 메트로놈 줄 아래에 선택 칸을 낸다 */
  subdivision?: SubdivisionPref;
  onSubdivision?: (v: SubdivisionPref) => void;
  /** 박 분할 풀이 문구용 BPM(지금 칠 실제 빠르기 = 원래 BPM × 연습 속도). 모르면 문구가 비어 있다 */
  songBpm?: number;
  /** 연습 속도 풀이(「BPM 120 → 84」)용 원래 BPM */
  sourceBpm?: number;
  padCount?: boolean;
  onPadCount?: (v: boolean) => void;
  /** 곡에 반주가 있는지. 없으면 비활성 + 이유 */
  hasAccompaniment?: boolean;
  /** 반주 재생 설정(켬·끔). 반주가 없는 곡에서는 꺼진 채 비활성이다 */
  accompaniment?: boolean;
  onAccompaniment?: (v: boolean) => void;
  /** 곡의 반주 생성 상태. 반주가 없을 때 이유 문구를 고른다(생성 중 / 반주 없음). 모르면 「반주 없음」 */
  accompanimentStatus?: AccompanimentStatus | null;
  /** 연습 속도 배율(0.5~1). onRate가 있을 때만 반주 줄 아래에 조절 줄을 낸다 */
  rate?: number;
  onRate?: (rate: number) => void;
}

export function PlayOptions({
  rows = ALL_PLAY_OPTION_ROWS,
  metronome = false,
  onMetronome,
  subdivision = 'auto',
  onSubdivision,
  songBpm,
  sourceBpm,
  padCount = false,
  onPadCount,
  hasAccompaniment = false,
  accompaniment = true,
  onAccompaniment,
  accompanimentStatus,
  rate = 1,
  onRate,
}: Props) {
  // READY인데 아직 못 불러온 경우도 비활성 문구가 비지 않게 「반주 없음」으로 둔다
  const missingText = accompanimentOptionText(accompanimentStatus) || '반주 없음';
  const showRecording = rows.includes('recording') && RECORDING_ENABLED;
  // 연습 속도는 반주가 울리지 않을 때만 고른다(느린 반주는 음정이 내려간다)
  const rateOpen = !hasAccompaniment || !accompaniment;
  return (
    <div className="play-opt" role="group" aria-label="연주 옵션">
      {rows.includes('metronome') && (
        <>
          <OptionRow label="메트로놈" help="곡 중에도 클릭이 울려요" checked={metronome} onChange={(v) => onMetronome?.(v)} />
          {onSubdivision && (
            // 꺼져 있으면 접히고 초점도 가지 않는다(inert)
            <div className={metronome ? 'play-opt-sub open' : 'play-opt-sub'} inert={!metronome}>
              <div className="play-opt-sub-in">
                <SubdivisionPicker value={subdivision} onChange={onSubdivision} bpm={songBpm} place="song" previewPlace="song" />
              </div>
            </div>
          )}
        </>
      )}
      {rows.includes('padCount') && (
        <OptionRow label="패드 박 번호" help="드럼 패드 위에 다음에 칠 박을 보여요" checked={padCount} onChange={(v) => onPadCount?.(v)} />
      )}
      {rows.includes('accompaniment') && (
        <>
          <OptionRow
            label="반주"
            help={hasAccompaniment ? (onRate && accompaniment ? '끄면 연습 속도를 고를 수 있어요' : undefined) : missingText}
            checked={hasAccompaniment && accompaniment}
            disabled={!hasAccompaniment}
            onChange={(v) => onAccompaniment?.(v)}
          />
          {onRate && (
            <div className={rateOpen ? 'play-opt-sub open' : 'play-opt-sub'} inert={!rateOpen}>
              <div className="play-opt-sub-in">
                <RateStepper rate={rate} onRate={onRate} sourceBpm={sourceBpm} />
              </div>
            </div>
          )}
        </>
      )}
      {showRecording && <RecordingRow />}
    </div>
  );
}

/** 옵션 한 줄: [이름 · 도움말 ··· 스위치]. 줄 어디를 눌러도 바뀐다(스위치 자체는 버튼이라 키보드·스크린리더는 스위치로 다룬다) */
function OptionRow({
  label,
  help,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className={disabled ? 'play-opt-row disabled' : 'play-opt-row'}
      onClick={(e) => {
        // 스위치를 직접 누른 경우는 스위치의 onChange가 처리한다
        if (disabled || (e.target as HTMLElement).closest('button')) return;
        onChange(!checked);
      }}
    >
      <span className="play-opt-text">
        <span className="play-opt-label">{label}</span>
        {help && <span className="play-opt-help">{help}</span>}
      </span>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} label={help && disabled ? `${label} (${help})` : label} />
    </div>
  );
}

/** 연습 속도 조절: [−] 배율 · 실제 BPM [+]. 5 % 단위이고 50 %·100 %에서 그쪽 버튼이 비활성이다 */
function RateStepper({ rate, onRate, sourceBpm }: { rate: number; onRate: (rate: number) => void; sourceBpm?: number }) {
  return (
    <div className="play-opt-rate">
      <span className="play-opt-rate-cap">연습 속도</span>
      <div className="play-opt-stepper" role="group" aria-label="연습 속도">
        <button type="button" className="play-opt-step" aria-label="5% 느리게" disabled={rate <= RATE_MIN} onClick={() => onRate(stepRate(rate, -1))}>
          −
        </button>
        <div className="play-opt-rate-val" aria-live="polite">
          <b>{rateLabel(rate)}</b>
          {sourceBpm !== undefined && <span>{rateHint(sourceBpm, rate)}</span>}
        </div>
        <button type="button" className="play-opt-step" aria-label="5% 빠르게" disabled={rate >= RATE_MAX} onClick={() => onRate(stepRate(rate, 1))}>
          +
        </button>
      </div>
    </div>
  );
}

/** 녹음 줄. arm(`idle ↔ armed`)만 바꾼다 — 연주 중 잠금·저장은 녹음 스토어 흐름 그대로 */
function RecordingRow() {
  const phase = useRecordingStore((s) => s.phase);
  const locked = useRecordingStore((s) => s.locked);
  const armed = phase === 'armed';
  // idle·armed가 아니면(녹음 중·저장 창) 바꿀 수 없다
  const disabled = locked || (phase !== 'idle' && phase !== 'armed');
  return <OptionRow label="이번 연주 녹음" checked={armed} disabled={disabled} onChange={() => toggleArm()} />;
}
