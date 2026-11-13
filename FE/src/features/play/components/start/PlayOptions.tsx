// 연주 옵션 줄 목록 (설계 MODE-001-MODE-003-picker-quick-start, Figma 905:4457 「연주 옵션」). 카드 껍데기 없이 체크 줄만 낸다 —
// 감싸는 쪽(시작 확인 창 등)이 제목·여백을 정한다. 보일 줄은 `rows`로 고른다(리듬 게임 재활용 대비).
// 메트로놈·패드 번호·반주는 props만 받고(설정 스토어 연결은 페이지), 녹음 줄만 녹음 스토어의 arm(`toggleArm`)을 직접 쓴다.
import { RECORDING_ENABLED } from '@/config/features';
import { toggleArm, useRecordingStore } from '@/runtime/recordingStore';
import { Checkbox } from '@/components/ui/Checkbox';
import { accompanimentOptionText, type AccompanimentStatus } from '@/domain/song/songCatalog';
import './play-options.css';

export type PlayOptionRow = 'metronome' | 'padCount' | 'accompaniment' | 'recording';

/** 악보 연습이 보이는 줄 전부 */
export const ALL_PLAY_OPTION_ROWS: readonly PlayOptionRow[] = ['metronome', 'padCount', 'accompaniment', 'recording'];

interface Props {
  /** 보일 줄. 기본은 네 줄 전부 */
  rows?: readonly PlayOptionRow[];
  metronome?: boolean;
  onMetronome?: (v: boolean) => void;
  padCount?: boolean;
  onPadCount?: (v: boolean) => void;
  /** 곡에 반주가 있는지. 없으면 비활성 + 이유 */
  hasAccompaniment?: boolean;
  /** 반주 재생 설정(켬·끔). 반주가 없는 곡에서는 체크되지 않은 채 비활성이다 */
  accompaniment?: boolean;
  onAccompaniment?: (v: boolean) => void;
  /** 곡의 반주 생성 상태. 반주가 없을 때 괄호 문구를 고른다(생성 중 / 반주 없음). 모르면 「반주 없음」 */
  accompanimentStatus?: AccompanimentStatus | null;
}

export function PlayOptions({
  rows = ALL_PLAY_OPTION_ROWS,
  metronome = false,
  onMetronome,
  padCount = false,
  onPadCount,
  hasAccompaniment = false,
  accompaniment = true,
  onAccompaniment,
  accompanimentStatus,
}: Props) {
  // READY인데 아직 못 불러온 경우도 비활성 문구가 비지 않게 「반주 없음」으로 둔다
  const missingText = accompanimentOptionText(accompanimentStatus) || '반주 없음';
  const showRecording = rows.includes('recording') && RECORDING_ENABLED;
  return (
    <div className="play-opt" role="group" aria-label="연주 옵션">
      {rows.includes('metronome') && (
        <Checkbox checked={metronome} onChange={(v) => onMetronome?.(v)} label="메트로놈 클릭을 곡 중에도 낸다" />
      )}
      {rows.includes('padCount') && (
        <Checkbox checked={padCount} onChange={(v) => onPadCount?.(v)} label="드럼 패드 위에 다음 칠 박 번호를 보인다" />
      )}
      {rows.includes('accompaniment') && (
        <Checkbox
          checked={hasAccompaniment && accompaniment}
          disabled={!hasAccompaniment}
          onChange={(v) => onAccompaniment?.(v)}
          label={`반주 재생${hasAccompaniment ? '' : ` (${missingText})`}`}
        />
      )}
      {showRecording && <RecordingRow />}
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
  return <Checkbox checked={armed} disabled={disabled} onChange={() => toggleArm()} label="이번 연주를 녹음한다" />;
}
