// 악보만 있는 라이브러리 항목의 목록 줄 (설계 CHART-001 악보 보관 4-2, D14·D15). MySongRow와 같은 틀(.studio-row, 64px).
// 동작 칸(220px)에 [악보 보기](secondary)와, onUploadSong이 있으면(재연결 스위치 켜짐) [⤒ 곡 올리기](브랜드 외곽선)를 둔다.
// 비활성 [악보 연습]·설명 문구는 두지 않는다.
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/action/Button';
import { buttonClassName } from '@/components/ui/action/buttonStyle';
import type { SheetSummary } from '@/features/studio/domain/sheetMusic';
import { dateLabel } from '@/features/studio/components/dateLabel';
import { SheetCover } from './SheetCover';
import { SheetMenu, type SheetMenuKind } from './SheetMenu';
import { sheetSubtitle } from './sheetItemText';
import { UploadIcon } from '@/components/song/StudioIcons';
import '@/features/studio/components/studio.css';

interface Props {
  sheet: SheetSummary;
  onMenu: (kind: SheetMenuKind, sheet: SheetSummary) => void;
  onCoverError?: () => void;
  /** 있으면 [곡 올리기]를 그린다. 없으면(스위치 꺼짐) 그 자리를 비운다 */
  onUploadSong?: (sheet: SheetSummary) => void;
}

export function SheetItemRow({ sheet, onMenu, onCoverError, onUploadSong }: Props) {
  return (
    <li className="studio-row sheet">
      <div className="studio-row-cover">
        <SheetCover sheet={sheet} onImageError={onCoverError} />
      </div>
      <span className="studio-row-info">
        <span className="studio-row-title" title={sheet.title}>
          {sheet.title}
        </span>
        <span className="studio-row-sub">{sheetSubtitle(sheet)}</span>
      </span>
      <span className="studio-chip">악보만</span>
      <span className="studio-row-date">{dateLabel(sheet.createdAt)}</span>
      <span className="studio-row-actions">
        <Link to={`/studio/sheets/${sheet.id}`} className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
          악보 보기
        </Link>
        {onUploadSong && (
          <Button
            variant="secondary"
            size="sm"
            className="studio-upload-song"
            leadingIcon={<UploadIcon size={16} />}
            aria-label={`「${sheet.title}」 곡 올리기`}
            onClick={() => onUploadSong(sheet)}
          >
            곡 올리기
          </Button>
        )}
      </span>
      <span className="studio-row-more">
        <SheetMenu title={sheet.title} onPick={(kind) => onMenu(kind, sheet)} />
      </span>
    </li>
  );
}
