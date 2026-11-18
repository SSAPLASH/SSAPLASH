// 악보 뷰어 화면 (설계 CHART-001 악보 보관 4-3~4-5). /studio/sheets/:id — 상세 조회·만료 전 갱신·바·몰입 모드·제목 수정·삭제.
// 그림은 SheetViewer·PdfPages가 그린다. URL·파일은 메모리에만 둔다(localStorage·Cache 저장 안 함).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { deleteSheet, getSheet, updateSheetTitle } from '@/features/studio/api/sheets';
import { SHEET_ARCHIVE_ENABLED } from '@/config/features';
import { SheetDeleteDialog } from '@/features/studio/components/sheet/SheetDeleteDialog';
import { SheetTitleDialog } from '@/features/studio/components/sheet/SheetTitleDialog';
import { SheetViewer, type SheetViewerState } from '@/features/studio/components/sheet/SheetViewer';
import { useShell } from '@/components/shell/nav/useShell';
import { SheetMenu, type SheetMenuKind } from '@/features/studio/components/sheet/SheetMenu';
import { SHEET_REFRESH_LEAD_MS, needsRefresh, sheetErrorCodeOf, type SheetDetail } from '@/features/studio/domain/sheetMusic';
import { toSafeId } from '@/domain/song/songCatalog';
import '@/features/studio/components/sheet/sheet-viewer.css';

/** 갱신이 같은 만료 시각을 돌려줄 때 무한 반복을 막는 최소 간격(ms) */
const MIN_REFRESH_MS = 30_000;

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}

function parseId(raw: string | undefined): number | null {
  try {
    return toSafeId(raw, 'sheetId');
  } catch {
    return null;
  }
}

export function SheetViewerPage() {
  const { id } = useParams();
  if (!SHEET_ARCHIVE_ENABLED) return <Navigate to="/studio" replace />;
  // id가 바뀌면 상태를 새로 시작한다
  return <ViewerBody key={id} />;
}

function ViewerBody() {
  const { id: rawId } = useParams();
  const id = parseId(rawId);
  const navigate = useNavigate();
  const [state, setState] = useState<SheetViewerState>('loading');
  const [detail, setDetail] = useState<SheetDetail | null>(null);
  const [page, setPage] = useState(1);
  const [pdfKey, setPdfKey] = useState(0);
  const [immersive, setImmersive] = useState(false);
  const [dialog, setDialog] = useState<SheetMenuKind | null>(null);
  const seq = useRef(0);
  const assetRetried = useRef(false);

  // 전체 화면(사이드바·TopBar 없음)
  useShell({ immersive: true });

  /** 상세 조회. silent면 화면을 그대로 두고 URL만 바꾼다. 성공 여부를 돌려준다 */
  const load = useCallback(
    async (silent: boolean): Promise<boolean> => {
      if (id === null) return false;
      const mine = ++seq.current;
      try {
        const d = await getSheet(id);
        if (mine !== seq.current) return false;
        setDetail(d);
        setState('ready');
        return true;
      } catch (e) {
        if (mine !== seq.current) return false;
        const missing = sheetErrorCodeOf(e) === 'SHEET_NOT_FOUND' || (e as { status?: number }).status === 404;
        if (missing) setState('missing');
        else if (!silent) setState('unavailable');
        return false;
      }
    },
    [id],
  );

  useEffect(() => {
    const counter = seq;
    // 마운트 뒤 조회 시작(첫 렌더는 이미 loading 상태)
    void Promise.resolve().then(() => load(false));
    return () => {
      counter.current++;
    };
  }, [load]);

  // 만료 2분 전에 상세를 다시 읽어 URL만 바꾼다. 보는 쪽·스크롤은 그대로
  const expiresAt = detail?.expiresAt ?? null;
  useEffect(() => {
    if (expiresAt === null || state !== 'ready') return;
    const delay = Math.max(MIN_REFRESH_MS, expiresAt - SHEET_REFRESH_LEAD_MS - Date.now());
    const t = window.setTimeout(() => void load(true), delay);
    return () => window.clearTimeout(t);
  }, [expiresAt, state, load]);

  // 탭이 잠자다 깨어 타이머가 늦었을 수 있으니, 쪽을 넘길 때 만료가 가까우면 바로 갱신한다
  const expiresRef = useRef<number | null>(null);
  useEffect(() => {
    expiresRef.current = expiresAt;
  }, [expiresAt]);
  useEffect(() => {
    if (expiresRef.current !== null && needsRefresh(expiresRef.current, Date.now())) void load(true);
  }, [page, load]);

  // 그림·PDF 읽기 실패: 상세를 한 번 다시 읽고, 또 실패하면 일시 오류
  const onAssetError = useCallback(async () => {
    if (assetRetried.current) {
      setState('unavailable');
      return;
    }
    assetRetried.current = true;
    const ok = await load(true);
    if (ok) setPdfKey((k) => k + 1);
    else setState((s) => (s === 'missing' ? s : 'unavailable'));
  }, [load]);

  const onAssetLoad = useCallback(() => {
    assetRetried.current = false;
  }, []);

  function goBack() {
    // react-router가 브라우저 기록에 idx를 둔다. 0보다 크면 앞 화면이 있다
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/studio');
  }

  const total = detail ? (detail.kind === 'PDF' ? detail.pageCount : detail.pages.length) : 0;
  const counter = state === 'ready' && total > 0 ? `${Math.min(page, total)}/${total}` : null;

  async function submitTitle(title: string) {
    if (id === null) return;
    const d = await updateSheetTitle(id, title);
    setDetail((cur) => (cur ? { ...cur, title: d.title } : cur));
  }

  async function confirmDelete() {
    if (id === null) return;
    await deleteSheet(id);
    navigate('/studio', { state: { sheetDeleted: true }, replace: true });
  }

  return (
    <div className={`sheet-viewer${immersive ? ' immersive' : ''}`} data-immersive={immersive}>
      <header className="sheet-viewer-bar" aria-hidden={immersive || undefined} inert={immersive || undefined}>
        <button type="button" className="sheet-back" onClick={goBack} aria-label="뒤로">
          <BackIcon />
          <span className="sheet-back-label">뒤로</span>
        </button>
        <h1 className="sheet-viewer-title">{detail?.title ?? ''}</h1>
        {detail ? <span className="sheet-kind-badge">{detail.kind === 'PDF' ? 'PDF' : '이미지'}</span> : null}
        {counter ? <span className="sheet-counter">{counter}</span> : null}
        {detail && state === 'ready' ? <SheetMenu title={detail.title} onPick={setDialog} className="sheet-viewer-more" /> : null}
      </header>
      {immersive && counter ? <span className="sheet-counter sheet-counter-float" data-testid="sheet-counter-float">{counter}</span> : null}
      <SheetViewer
        state={id === null ? 'missing' : state}
        detail={detail}
        page={page}
        onPageChange={setPage}
        pdfKey={pdfKey}
        onToggleImmersive={() => setImmersive((v) => !v)}
        onAssetError={() => void onAssetError()}
        onAssetLoad={onAssetLoad}
        onRetry={() => {
          setState('loading');
          void load(false);
        }}
        onLibrary={() => navigate('/studio')}
      />
      {dialog === 'rename' && detail ? <SheetTitleDialog title={detail.title} onSubmit={submitTitle} onClose={() => setDialog(null)} /> : null}
      {dialog === 'delete' && detail ? <SheetDeleteDialog title={detail.title} onConfirm={confirmDelete} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
