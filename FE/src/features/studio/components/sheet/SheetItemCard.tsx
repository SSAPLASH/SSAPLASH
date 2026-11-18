// 악보만 있는 라이브러리 항목의 카드 (설계 CHART-001 악보 보관 4-2, D14·D15). MySongCard와 같은 틀(.studio-card)·같은 줄 수다.
// 커버 = 썸네일·자리표시, 부제 = 「악보 · 이미지 n쪽」/「악보 · PDF」, 칩 「악보만」, 주 버튼 [악보 보기](primary, Figma 12 B-1).
// 비활성 ▶·[악보 연습]·설명 문구는 두지 않는다. onUploadSong이 있으면(재연결 스위치 켜짐) ▶ 자리에 같은 크기의 원형 업로드 버튼을 둔다.
import { Link } from 'react-router-dom';
import { buttonClassName } from '@/components/ui/action/buttonStyle';
import type { SheetSummary } from '@/features/studio/domain/sheetMusic';
import { SheetCover } from './SheetCover';
import { SheetMenu, type SheetMenuKind } from './SheetMenu';
import { sheetSubtitle } from './sheetItemText';
import { UploadIcon } from '@/components/song/StudioIcons';
import '@/features/studio/components/studio.css';

interface Props {
  sheet: SheetSummary;
  onMenu: (kind: SheetMenuKind, sheet: SheetSummary) => void;
  onCoverError?: () => void;
  /** 있으면 ▶ 자리에 업로드 버튼(곡 올리기)을 그린다. 없으면(스위치 꺼짐) 그 자리를 비운다 */
  onUploadSong?: (sheet: SheetSummary) => void;
}

export function SheetItemCard({ sheet, onMenu, onCoverError, onUploadSong }: Props) {
  return (
    <li className="studio-card sheet">
      <div className="studio-card-cover">
        <SheetCover sheet={sheet} onImageError={onCoverError} />
        {onUploadSong && (
          <button
            type="button"
            className="song-card-play song-card-upload"
            aria-label={`「${sheet.title}」 곡 올리기`}
            title="곡 올리기"
            onClick={() => onUploadSong(sheet)}
          >
            <UploadIcon size={24} />
          </button>
        )}
        <SheetMenu className="studio-card-menu" title={sheet.title} onPick={(kind) => onMenu(kind, sheet)} />
      </div>
      <span className="studio-card-title" title={sheet.title}>
        {sheet.title}
      </span>
      <span className="studio-card-artist">{sheetSubtitle(sheet)}</span>
      <div className="studio-card-badges">
        <span className="studio-chip">악보만</span>
      </div>
      <div className="studio-card-actions">
        <Link to={`/studio/sheets/${sheet.id}`} className={buttonClassName({ variant: 'primary', size: 'sm', fullWidth: true })}>
          악보 보기
        </Link>
      </div>
    </li>
  );
}
