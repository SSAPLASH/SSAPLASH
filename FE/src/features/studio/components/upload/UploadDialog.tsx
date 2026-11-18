// 곡 올리기 창(모달) 틀 (Figma Studio / UploadDialog 224:1069, 폭 560). 배경·제목·닫기·Esc·포커스만 맡고 안은 children이다.
// 열림·잠금은 호출자(StudioPage)가 정한다. locked(업로드 중)이면 닫기·Esc·배경 클릭·섹션 전환을 무시한다.
// title·notice는 악보에 곡 올리기 모드용이다: 제목을 바꾸고 제목 아래에 안내 한 줄을 둔다(섹션 전환은 section을 안 주면 없다).
// section을 주면(악보 기능 켜짐) 제목이 「올리기」가 되고 맨 위에 [음원·MIDI | 악보] 전환이 생긴다(설계 CHART-001 악보 보관 D2).
import type { ReactNode } from 'react';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { IconButton } from '@/components/ui/action/IconButton';
import { Segmented } from '@/components/ui/form/Segmented';
import { CloseIcon } from '@/components/song/StudioIcons';
import '@/features/studio/components/studio.css';

/** 올리기 창의 섹션 */
export type UploadSection = 'SONG' | 'SHEET';

interface Props {
  open: boolean;
  locked: boolean;
  onClose: () => void;
  /** 없으면 기존 「곡 올리기」 창 그대로 */
  section?: { value: UploadSection; onChange: (value: UploadSection) => void };
  /** 창 제목을 직접 정한다(악보에 곡 올리기: 「곡 올리기」). 없으면 section 유무로 정한다 */
  title?: string;
  /** 제목 아래 안내 한 줄(악보에 곡 올리기: 「「악보 제목」 악보에 연결돼요」) */
  notice?: string;
  children: ReactNode;
}

export function UploadDialog({ open, locked, onClose, section, title, notice, children }: Props) {
  if (!open) return null;

  // 열릴 때 창에 포커스(안쪽에서 이미 가져갔으면 — 다시 올리기 프리필의 [파일 고르기] — 그대로). locked면 Esc·배경 클릭을 막는다
  return (
    <Dialog className="studio-dialog studio-dialog-upload" labelledBy="upload-title" closeOnBackdrop={!locked} closeOnEscape={!locked} onClose={onClose}>
      <div className="studio-dialog-head">
        <h2 id="upload-title">{title ?? (section ? '올리기' : '곡 올리기')}</h2>
        <IconButton size="sm" label="닫기" className="studio-dialog-close" onClick={onClose} disabled={locked}>
          <CloseIcon />
        </IconButton>
      </div>
      {notice && <p className="studio-link-notice">{notice}</p>}
      {section && (
        <div className="studio-seg-row">
          <Segmented<UploadSection>
            label="올리는 종류"
            value={section.value}
            onChange={(v) => {
              if (!locked) section.onChange(v);
            }}
            options={[
              { value: 'SONG', label: '음원·MIDI' },
              { value: 'SHEET', label: '악보' },
            ]}
          />
        </div>
      )}
      {children}
    </Dialog>
  );
}
