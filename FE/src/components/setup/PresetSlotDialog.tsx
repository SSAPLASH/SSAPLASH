// Figma 프리셋 슬롯 창 772:33828(폭 570) · Setup / PresetSlot 505:2501 — 3열 슬롯: 0번 시스템 기본, 1~N 저장 슬롯, 나머지 빈 슬롯.
// 슬롯을 누르면 적용, 빈 슬롯을 누르면 저장(이름 창으로). 초안 모드(추가하기 보정 결과를 들고 열림)에서는 빈 슬롯만 누를 수 있다(UX-64 U9).
// 상태를 갖지 않는다 — 적용·저장 실행은 호출자가 한다.
import { useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { PRESET_SLOTS, SYSTEM_PRESET_ID, isSystemPreset, type KitPreset } from '@/domain/preset';
import './setup.css';

interface Props {
  open: boolean;
  presets: readonly KitPreset[];
  activeId: string;
  /** 초안 모드: 채워진 슬롯·시스템 기본은 비활성, 빈 슬롯만 누를 수 있다 */
  draftMode: boolean;
  busy: boolean;
  onApply: (id: string) => void;
  /** 빈 슬롯 번호(1부터) */
  onPickEmpty: (slot: number) => void;
  onClose: () => void;
}

/** 저장 시각 「10.23 저장」 */
function savedText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '저장됨';
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')} 저장`;
}

export function PresetSlotDialog(props: Props) {
  return props.open ? <PresetSlotDialogBody {...props} /> : null;
}

function PresetSlotDialogBody({ presets, activeId, draftMode, busy, onApply, onPickEmpty, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const system = isSystemPreset(activeId);
  const slots = Array.from({ length: PRESET_SLOTS }, (_, i) => presets[i] ?? null);

  return (
    <Dialog className="setup-slot-dialog" labelledBy="preset-slot-title" initialFocusRef={closeRef} closeOnBackdrop={!busy} closeOnEscape={!busy} onClose={onClose}>
      <div className="setup-slot-head">
        <h2 id="preset-slot-title">프리셋</h2>
        <p>{draftMode ? '빈 슬롯을 누르면 방금 보정한 배치를 저장해요.' : '슬롯을 누르면 그 배치로 바뀌어요. 빈 슬롯을 누르면 지금 배치를 저장해요.'}</p>
      </div>
      <div className="setup-slot-grid" role="list">
        <button
          type="button"
          role="listitem"
          className={`setup-slot is-system${system ? ' active' : ''}`}
          disabled={busy || draftMode || system}
          onClick={() => onApply(SYSTEM_PRESET_ID)}
        >
          <span className="setup-slot-top">
            <span className="setup-slot-label">0 · 시스템</span>
            {system && (
              <span className="setup-slot-active">
                <span className="setup-slot-dot" aria-hidden="true" />
                적용 중
              </span>
            )}
          </span>
          <span className="setup-slot-name">기본 배치</span>
          <span className="setup-slot-meta">시스템 기본 · 바꿀 수 없음</span>
        </button>
        {slots.map((p, i) =>
          p ? (
            <button
              key={p.id}
              type="button"
              role="listitem"
              className={`setup-slot is-saved${p.id === activeId ? ' active' : ''}`}
              disabled={busy || draftMode || p.id === activeId}
              onClick={() => onApply(p.id)}
            >
              <span className="setup-slot-top">
                <span className="setup-slot-label">슬롯 {i + 1}</span>
                {p.id === activeId && (
                  <span className="setup-slot-active">
                    <span className="setup-slot-dot" aria-hidden="true" />
                    적용 중
                  </span>
                )}
              </span>
              <span className="setup-slot-name">{p.name}</span>
              <span className="setup-slot-meta">{savedText(p.updatedAt)}</span>
            </button>
          ) : (
            <button key={`empty-${i}`} type="button" role="listitem" className="setup-slot is-empty" disabled={busy} onClick={() => onPickEmpty(i + 1)}>
              <span className="setup-slot-top">
                <span className="setup-slot-label">슬롯 {i + 1}</span>
              </span>
              <span className="setup-slot-name">{draftMode ? '+ 여기에 저장' : '+ 현재 배치 저장'}</span>
              <span className="setup-slot-meta">빈 슬롯</span>
            </button>
          ),
        )}
      </div>
      <div className="setup-slot-actions">
        <Button variant="secondary" ref={closeRef} onClick={onClose} disabled={busy}>
          닫기
        </Button>
      </div>
    </Dialog>
  );
}
