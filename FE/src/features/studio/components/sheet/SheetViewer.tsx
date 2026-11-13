// 악보 뷰어 본문 (Figma Studio / SheetViewer 452:1685 — image·pdf·missing·unavailable 4변형, 설계 CHART-001 악보 보관 4-3·4-4).
// 데이터는 모른다. 조회·갱신·재시도는 SheetViewerPage가 맡고, 여기는 받은 상태를 그린다.
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/action/Button';
import { EmptyState } from '@/components/ui/feedback/EmptyState';
import { sheetErrorText, type SheetDetail } from '@/features/studio/domain/sheetMusic';
import { PdfPages } from './PdfPages';
import './sheet-viewer.css';
import { ErrorState } from '@/components/ui/feedback/ErrorState';

export type SheetViewerState = 'loading' | 'ready' | 'missing' | 'unavailable';

interface Props {
  state: SheetViewerState;
  detail: SheetDetail | null;
  /** 보는 쪽(1부터) */
  page: number;
  onPageChange: (page: number) => void;
  /** PDF를 새로 읽을 때 바뀌는 값(쪽 그리기 실패 뒤 다시 읽기) */
  pdfKey: number;
  onToggleImmersive: () => void;
  /** 그림·PDF 읽기 실패 */
  onAssetError: () => void;
  /** 그림·PDF를 읽었다 */
  onAssetLoad: () => void;
  onRetry: () => void;
  onLibrary: () => void;
  /** 이미지 넘김 버튼 표시 여부 */
  showArrows?: boolean;
}

/** 가장자리 탭으로 보는 폭 비율 */
const EDGE = 0.25;
/** 이 거리(px) 이상 움직이면 탭이 아니라 밀기 */
const SWIPE_PX = 48;

export function SheetViewer({ state, detail, page, onPageChange, pdfKey, onToggleImmersive, onAssetError, onAssetLoad, onRetry, onLibrary, showArrows = true }: Props) {
  if (state === 'loading') {
    return (
      <div className="sheet-viewer-stage" role="status" aria-live="polite">
        <p className="sheet-viewer-loading">악보를 불러오는 중…</p>
      </div>
    );
  }
  if (state === 'missing') {
    return (
      <div className="sheet-viewer-stage">
        <EmptyState title={sheetErrorText('SHEET_NOT_FOUND')} action={<Button onClick={onLibrary}>라이브러리로</Button>} />
      </div>
    );
  }
  if (state === 'unavailable' || !detail) {
    return (
      <div className="sheet-viewer-stage">
        <ErrorState size="lg" title="지금은 악보를 볼 수 없어요" description="잠시 뒤 다시 시도해 주세요" onRetry={onRetry} />
      </div>
    );
  }
  if (detail.kind === 'PDF') {
    const url = detail.pages[0]?.url;
    return (
      <div className="sheet-viewer-stage">
        {url ? <PdfPages key={pdfKey} url={url} initialPage={page} onVisiblePage={onPageChange} onError={onAssetError} onLoaded={onAssetLoad} onTap={onToggleImmersive} /> : null}
      </div>
    );
  }
  return <ImagePages detail={detail} page={page} onPageChange={onPageChange} onToggleImmersive={onToggleImmersive} onAssetError={onAssetError} onAssetLoad={onAssetLoad} showArrows={showArrows} />;
}

function ImagePages({ detail, page, onPageChange, onToggleImmersive, onAssetError, onAssetLoad, showArrows }: Pick<Props, 'detail' | 'page' | 'onPageChange' | 'onToggleImmersive' | 'onAssetError' | 'onAssetLoad'> & { detail: SheetDetail; showArrows: boolean }) {
  const total = detail.pages.length;
  const current = detail.pages[page - 1];
  const down = useRef<{ x: number; y: number } | null>(null);

  function go(delta: number) {
    const next = Math.min(total, Math.max(1, page + delta));
    if (next !== page) onPageChange(next);
  }

  // ← → 키. 입력란에서는 건드리지 않는다
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') onPageChange(Math.max(1, page - 1));
      else if (e.key === 'ArrowRight') onPageChange(Math.min(total, page + 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, total, onPageChange]);

  // 다음 쪽 그림을 미리 받아 둔다(메모리에만)
  const next = detail.pages[page]?.url;
  useEffect(() => {
    if (!next) return;
    const img = new Image();
    img.src = next;
  }, [next]);

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const start = down.current;
    down.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    const width = e.currentTarget.getBoundingClientRect().width || window.innerWidth;
    const ratio = (e.clientX - e.currentTarget.getBoundingClientRect().left) / width;
    if (ratio < EDGE) go(-1);
    else if (ratio > 1 - EDGE) go(1);
    else onToggleImmersive();
  }

  return (
    <div className="sheet-viewer-stage">
      <div
        className="sheet-image-area"
        data-testid="sheet-image-area"
        onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (down.current = null)}
      >
        {current ? <img key={current.url} className="sheet-image" src={current.url} alt={`${detail.title} ${page}쪽`} draggable={false} onError={onAssetError} onLoad={onAssetLoad} /> : null}
      </div>
      {showArrows && total > 1 ? (
        <>
          <button type="button" className="sheet-arrow sheet-arrow-prev" aria-label="이전 쪽" disabled={page <= 1} onClick={() => go(-1)}>
            ‹
          </button>
          <button type="button" className="sheet-arrow sheet-arrow-next" aria-label="다음 쪽" disabled={page >= total} onClick={() => go(1)}>
            ›
          </button>
        </>
      ) : null}
      <p className="sheet-page-caption" aria-live="polite">
        {page} / {total}쪽
      </p>
    </div>
  );
}
