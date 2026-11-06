// 악보만 있는 라이브러리 항목의 카드 (설계 CHART-001 악보 보관 4-2). MySongCard와 같은 틀(.studio-card)이다.
// 커버 = 썸네일·자리표시, 부제 = 「악보 · 이미지 n쪽」/「악보 · PDF」, 칩 「악보만」, 주 버튼 [악보 보기].
// 리듬 게임 ▶과 [악보 연습]은 비활성으로 보이고 「음원이 있어야 할 수 있어요」 설명을 단다(U8).
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyle';
import type { SheetSummary } from '@/domain/sheetMusic';
import { SheetCover } from './SheetCover';
import { SheetMenu, type SheetMenuKind } from './SheetMenu';
import { SHEET_NO_AUDIO_HINT, sheetSubtitle } from './sheetItemText';
import { PlayIcon } from './StudioIcons';
import './studio.css';

interface Props {
  sheet: SheetSummary;
  onMenu: (kind: SheetMenuKind, sheet: SheetSummary) => void;
  onCoverError?: () => void;
}

export function SheetItemCard({ sheet, onMenu, onCoverError }: Props) {
  const hintId = `sheet-hint-card-${sheet.id}`;
  return (
    <li className="studio-card sheet">
      <div className="studio-card-cover">
        <SheetCover sheet={sheet} onImageError={onCoverError} />
        <button
          type="button"
          className="song-card-play disabled"
          disabled
          aria-label={`「${sheet.title}」 리듬 게임`}
          aria-describedby={hintId}
          title={SHEET_NO_AUDIO_HINT}
        >
          <PlayIcon />
        </button>
        <SheetMenu className="studio-card-menu" title={sheet.title} onPick={(kind) => onMenu(kind, sheet)} />
      </div>
      <span className="studio-card-title" title={sheet.title}>
        {sheet.title}
      </span>
      <span className="studio-card-artist">{sheetSubtitle(sheet)}</span>
      <div className="studio-card-badges">
        <span className="studio-chip">악보만</span>
      </div>
      <p id={hintId} className="studio-sheet-hint">
        {SHEET_NO_AUDIO_HINT}
      </p>
      <div className="studio-card-actions studio-sheet-actions">
        <Link to={`/studio/sheets/${sheet.id}`} className={buttonClassName({ variant: 'primary', size: 'sm', fullWidth: true })}>
          악보 보기
        </Link>
        <Button variant="secondary" size="sm" fullWidth disabled aria-describedby={hintId} title={SHEET_NO_AUDIO_HINT}>
          악보 연습
        </Button>
      </div>
    </li>
  );
}
