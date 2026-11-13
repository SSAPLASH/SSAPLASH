// 내 드럼 무대의 프리셋 칩 줄(Figma 765:33421·765:33496, UX-64): [시스템 기본 · 고정] [내 배치] … | 완료 시각 pill + [프리셋 관리].
// 보정 시작([새로 보정]·[다시 보정])은 무대 머리 줄에 있고 보정 진행·취소는 보정 팝업(CalibrationDialog)이 맡는다(SETUP-fixed-kit-noir D5).
// 상태는 props로만 받고 세션·스토어 호출은 콜백으로 한다.
import { Button } from '@/components/ui/action/Button';
import { Chip } from '@/components/ui/layout/Chip';
import { StatusPill } from '@/components/ui/feedback/StatusPill';
import { SYSTEM_PRESET_ID, isSystemPreset, type KitPreset } from '@/domain/kit/preset';

export interface PresetChipsProps {
  presets: readonly KitPreset[];
  activeId: string;
  /** 적용 프리셋의 보정 시각 문구(「완료 14:02」의 시각 부분). 없으면 pill을 그리지 않는다 */
  calibratedText: string | null;
  /** 센서 모드가 아니면 보정 pill 대신 「키보드만」 pill */
  sensorMode: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  /** 프리셋 창(슬롯 목록)을 연다. 적용·지우기·현재 배치 저장 */
  onManage: () => void;
}

/** 저장 슬롯이 다 찼을 때 [새로 보정] 비활성 안내(UX-64 U9) */
export const SLOTS_FULL_TEXT = '슬롯이 다 찼어요 · 프리셋을 지우고 추가하세요';

/** 격자 아이콘(16px): 프리셋 슬롯 목록 */
function GridIcon() {
  return (
    <svg className="setup-chips-plus" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="2.5" width="5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="5" height="4.5" rx="1" />
      <rect x="2" y="9" width="5" height="4.5" rx="1" />
      <rect x="9" y="9" width="5" height="4.5" rx="1" />
    </svg>
  );
}

export function PresetChips({
  presets,
  activeId,
  calibratedText,
  sensorMode,
  busy,
  onSelect,
  onManage,
}: PresetChipsProps) {
  const system = isSystemPreset(activeId);
  const locked = busy;

  return (
    <div className="setup-preset-chips" role="group" aria-label="프리셋">
      <div className="setup-chips-row">
        <Chip selected={system} disabled={locked} onClick={() => onSelect(SYSTEM_PRESET_ID)}>
          시스템 기본 · 고정
        </Chip>
        {presets.map((p) => (
          <Chip key={p.id} selected={p.id === activeId} disabled={locked} onClick={() => onSelect(p.id)}>
            {p.name}
          </Chip>
        ))}
      </div>
      <div className="setup-chips-right">
        {!sensorMode ? (
          <StatusPill variant="neutral">키보드만</StatusPill>
        ) : (
          <>
            {calibratedText && <StatusPill variant="ok">완료 {calibratedText}</StatusPill>}
            {!system && !calibratedText && <StatusPill variant="amber">보정 필요</StatusPill>}
          </>
        )}
        <Button variant="text" size="sm" className="setup-chips-add setup-chips-manage" onClick={onManage} disabled={busy}>
          <GridIcon />
          프리셋 관리
        </Button>
      </div>
    </div>
  );
}
