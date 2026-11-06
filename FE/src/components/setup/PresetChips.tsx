// 드럼 배치 카드 칩 줄(UX-64): [시스템 기본 · 고정] [내 배치] … [+ 추가하기] | 완료 시각 pill + [전체 보정].
// 보정 중에는 「새 프리셋 · 보정 중」(추가하기) 또는 적용 칩 유지 + 「보정 중 n / 7」 pill + [보정 취소].
// 상태는 props로만 받고 세션·스토어 호출은 콜백으로 한다. Figma 수치는 디자인 MR에서 입힌다.
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { StatusPill } from '@/components/ui/StatusPill';
import { PRESET_SLOTS, SYSTEM_PRESET_ID, isSystemPreset, type KitPreset } from '@/domain/preset';
import { capturePillText } from '@/components/calibration/calibrationText';

export interface PresetChipsProps {
  presets: readonly KitPreset[];
  activeId: string;
  /** 보정 중이면 대상·진행(index는 0부터). 아니면 null */
  calibrating: { target: 'new' | 'active'; index: number; total: number } | null;
  /** 적용 프리셋의 보정 시각 문구(「완료 14:02」의 시각 부분). 없으면 pill을 그리지 않는다 */
  calibratedText: string | null;
  /** 센서 모드가 아니면 보정 버튼이 없다(키보드만 pill) */
  sensorMode: boolean;
  /** 연결된 손이 없으면 보정 버튼 비활성 */
  canCalibrate: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onFullCalibrate: () => void;
  onCancel: () => void;
}

/** 저장 슬롯이 다 찼을 때 [추가하기] 비활성 안내(UX-64 U9) */
export const SLOTS_FULL_TEXT = '슬롯이 다 찼어요 · 프리셋을 지우고 추가하세요';

export function PresetChips({
  presets,
  activeId,
  calibrating,
  calibratedText,
  sensorMode,
  canCalibrate,
  busy,
  onSelect,
  onAdd,
  onFullCalibrate,
  onCancel,
}: PresetChipsProps) {
  const system = isSystemPreset(activeId);
  const newCapture = calibrating?.target === 'new';
  const full = presets.length >= PRESET_SLOTS;
  const locked = busy || calibrating !== null;

  return (
    <div className="setup-chips setup-preset-chips" role="group" aria-label="프리셋">
      <div className="setup-chips-row">
        <Chip selected={system && !newCapture} disabled={locked} onClick={() => onSelect(SYSTEM_PRESET_ID)}>
          시스템 기본 · 고정
        </Chip>
        {presets.map((p) => (
          <Chip key={p.id} selected={p.id === activeId && !newCapture} disabled={locked} onClick={() => onSelect(p.id)}>
            {p.name}
          </Chip>
        ))}
        {newCapture ? (
          <Chip selected disabled>
            새 프리셋 · 보정 중
          </Chip>
        ) : (
          sensorMode && (
            <Button variant="text" size="sm" onClick={onAdd} disabled={locked || !canCalibrate || full} title={full ? SLOTS_FULL_TEXT : undefined}>
              <span aria-hidden="true">+</span> 추가하기
            </Button>
          )
        )}
      </div>
      <div className="setup-chips-right">
        {!sensorMode ? (
          <StatusPill variant="neutral">키보드만</StatusPill>
        ) : calibrating ? (
          <>
            <StatusPill variant="accent">{capturePillText(calibrating.index, calibrating.total)}</StatusPill>
            <Button variant="text" size="sm" onClick={onCancel}>
              보정 취소
            </Button>
          </>
        ) : (
          <>
            {calibratedText && <StatusPill variant="ok">완료 {calibratedText}</StatusPill>}
            {!system && !calibratedText && <StatusPill variant="amber">보정 필요</StatusPill>}
            <Button variant="secondary" size="sm" onClick={onFullCalibrate} disabled={system || !canCalibrate || busy}>
              전체 보정
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
