// Figma 프리셋 슬롯 창 772:33828(폭 570, 지금은 무대 크기로 키우고 가운데 정렬·네온 선택·울림 호버를 얹었다) · Setup / PresetSlot 505:2501 — 3열 슬롯: 0번 시스템 기본, 1~N 저장 슬롯, 나머지 빈 슬롯.
// 슬롯을 누르면 적용, 빈 슬롯을 누르면 저장(이름 창으로). 초안 모드(추가하기 보정 결과를 들고 열림)에서는 빈 슬롯만 누를 수 있다(UX-64 U9).
// 저장 슬롯 오른쪽 위 휴지통을 누르면 그 카드가 삭제 확인으로 바뀐다(초안 모드에는 휴지통이 없다).
// 적용·저장·삭제 실행은 호출자가 한다. 이 창은 「어느 슬롯을 지우려는지」만 기억한다.
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { PRESET_SLOTS, SYSTEM_PRESET_ID, isSystemPreset, type KitPreset } from '@/domain/kit/preset';
import '@/features/setup/components/setup.css';
import { StrikeButton } from '@/features/setup/components/StrikeButton';

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
  /** 저장 슬롯 삭제(확인 뒤 호출). 없으면 휴지통을 그리지 않는다 */
  onDelete?: (id: string) => void;
  /** 삭제·저장 실패 문구. 창 아래에 보인다 */
  error?: string | null;
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

/** 휴지통 아이콘(16px) */
function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5M6.8 7v3.5M9.2 7v3.5" />
    </svg>
  );
}

function PresetSlotDialogBody({ presets, activeId, draftMode, busy, onApply, onPickEmpty, onDelete, error, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  /** 삭제 확인 중인 프리셋 id. 목록에서 사라지면(삭제됨) 자연히 무시된다 */
  const [asking, setAsking] = useState<string | null>(null);
  const canDelete = onDelete !== undefined && !draftMode;
  const system = isSystemPreset(activeId);
  const slots = Array.from({ length: PRESET_SLOTS }, (_, i) => presets[i] ?? null);

  return (
    <Dialog className="setup-slot-dialog" labelledBy="preset-slot-title" initialFocusRef={closeRef} closeOnBackdrop={!busy} closeOnEscape={!busy} onClose={onClose}>
      <div className="setup-slot-head">
        <h2 id="preset-slot-title">프리셋</h2>
        <p>{draftMode ? '빈 슬롯을 누르면 방금 보정한 배치를 저장해요.' : '슬롯을 누르면 그 배치로 바뀌어요. 빈 슬롯을 누르면 지금 배치를 저장해요.'}</p>
      </div>
      <div className="setup-slot-grid" role="list">
        <StrikeButton
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
        </StrikeButton>
        {slots.map((p, i) =>
          p ? (
            canDelete && asking === p.id ? (
              <div key={p.id} role="listitem" className={`setup-slot is-saved is-confirm${p.id === activeId ? ' active' : ''}`}>
                <span className="setup-slot-question">
                  <b>'{p.name}'</b> 프리셋을 지울까요?
                </span>
                <span className="setup-slot-confirm-note">{p.id === activeId ? '지우면 시스템 기본으로 바뀌어요. ' : ''}되돌릴 수 없어요.</span>
                <span className="setup-slot-confirm-row">
                  <Button variant="secondary" size="sm" onClick={() => setAsking(null)} disabled={busy}>
                    취소
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => onDelete(p.id)} disabled={busy}>
                    삭제
                  </Button>
                </span>
              </div>
            ) : (
              <div key={p.id} role="listitem" className={`setup-slot-cell${canDelete ? ' has-delete' : ''}`}>
                <StrikeButton type="button" className={`setup-slot is-saved${p.id === activeId ? ' active' : ''}`} disabled={busy || draftMode || p.id === activeId} onClick={() => onApply(p.id)}>
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
                </StrikeButton>
                {canDelete && (
                  <button type="button" className="setup-slot-delete" aria-label={`${p.name} 프리셋 지우기`} disabled={busy} onClick={() => setAsking(p.id)}>
                    <TrashIcon />
                  </button>
                )}
              </div>
            )
          ) : (
            <StrikeButton key={`empty-${i}`} type="button" role="listitem" className="setup-slot is-empty" disabled={busy} onClick={() => onPickEmpty(i + 1)}>
              <span className="setup-slot-top">
                <span className="setup-slot-label">슬롯 {i + 1}</span>
              </span>
              <span className="setup-slot-name">{draftMode ? '+ 여기에 저장' : '+ 현재 배치 저장'}</span>
              <span className="setup-slot-meta">빈 슬롯</span>
            </StrikeButton>
          ),
        )}
      </div>
      {error && (
        <p className="setup-slot-error" role="alert">
          {error}
        </p>
      )}
      <div className="setup-slot-actions">
        <span className="setup-slot-count">
          저장 {Math.min(presets.length, PRESET_SLOTS)} / {PRESET_SLOTS}
        </span>
        <Button variant="secondary" ref={closeRef} onClick={onClose} disabled={busy}>
          닫기
        </Button>
      </div>
    </Dialog>
  );
}
