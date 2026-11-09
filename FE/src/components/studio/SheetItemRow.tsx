// 악보만 있는 라이브러리 항목의 목록 줄 (설계 CHART-001 악보 보관 4-2). MySongRow와 같은 틀(.studio-row, 64px).
// 동작 칸(220px)이 좁아 비활성 [악보 연습]과 주 버튼 [악보 보기] 둘만 둔다(리듬 게임 ▶은 카드에만 비활성으로 둔다).
// [악보 연습]은 「음원이 있어야 할 수 있어요」 설명을 단다.
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyle';
import type { SheetSummary } from '@/domain/sheetMusic';
import { dateLabel } from './dateLabel';
import { SheetCover } from './SheetCover';
import { SheetMenu, type SheetMenuKind } from './SheetMenu';
import { SHEET_NO_AUDIO_HINT, sheetSubtitle } from './sheetItemText';
import './studio.css';

interface Props {
  sheet: SheetSummary;
  onMenu: (kind: SheetMenuKind, sheet: SheetSummary) => void;
  onCoverError?: () => void;
}

export function SheetItemRow({ sheet, onMenu, onCoverError }: Props) {
  const hintId = `sheet-hint-row-${sheet.id}`;
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
      <span id={hintId} className="studio-sheet-hint-hidden">
        {SHEET_NO_AUDIO_HINT}
      </span>
      <span className="studio-row-actions">
        <Button variant="secondary" size="sm" disabled aria-describedby={hintId} title={SHEET_NO_AUDIO_HINT}>
          악보 연습
        </Button>
        <Link to={`/studio/sheets/${sheet.id}`} className={buttonClassName({ variant: 'primary', size: 'sm' })}>
          악보 보기
        </Link>
      </span>
      <span className="studio-row-more">
        <SheetMenu title={sheet.title} onPick={(kind) => onMenu(kind, sheet)} />
      </span>
    </li>
  );
}
