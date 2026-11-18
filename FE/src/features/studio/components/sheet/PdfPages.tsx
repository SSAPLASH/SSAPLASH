// PDF 악보 쪽 그리기 (설계 CHART-001 악보 보관 D12). pdf.js를 이 컴포넌트에서만 동적 import 해 뷰어 라우트 밖 번들에 넣지 않는다.
// 쪽을 세로로 이어 화면 폭에 맞춰 canvas에 그리고, 화면 밖 쪽은 그리기를 미룬다. 가운데에 오는 쪽 번호를 올려 보낸다.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

interface Props {
  /** PDF 서명 URL. 마운트 때 한 번만 읽는다(보기 URL 갱신으로 바뀌어도 이미 읽은 문서와 스크롤을 유지). 다시 읽으려면 key를 바꾼다 */
  url: string;
  /** 처음 맞출 쪽(1부터). 다시 읽은 뒤 위치를 되돌릴 때 쓴다 */
  initialPage?: number;
  onPageCount?: (total: number) => void;
  /** 화면 가운데에 걸친 쪽(1부터) */
  onVisiblePage: (page: number) => void;
  /** 읽기·그리기 실패 */
  onError: () => void;
  /** 문서를 읽었다 */
  onLoaded?: () => void;
  /** 영역을 탭했다(몰입 모드 전환) */
  onTap?: () => void;
}

/** 쪽 하나. 화면 근처에 들어오면 그리고, 폭이 바뀌면 다시 그린다 */
function PdfPageSlot({ doc, pageNo, width, ratio, onError }: { doc: PDFDocumentProxy; pageNo: number; width: number; ratio: number; onError: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const el = holder.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: '120% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near || width <= 0) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const page = await doc.getPage(pageNo);
      if (cancelled || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * dpr });
      const c = canvas.current;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      c.style.width = `${width}px`;
      c.style.height = `${Math.floor(viewport.height / dpr)}px`;
      task = page.render({ canvas: c, viewport });
      await task.promise;
    })().catch((e: unknown) => {
      // 폭 변경·화면 밖으로 나가 취소된 그리기는 실패가 아니다
      if (cancelled || (e as { name?: string })?.name === 'RenderingCancelledException') return;
      onError();
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, width, doc, pageNo, onError]);

  return (
    <div ref={holder} className="pdf-slot" data-page={pageNo} style={{ width, height: Math.round(width * ratio) }}>
      {near ? <canvas ref={canvas} aria-label={`${pageNo}쪽`} role="img" /> : null}
    </div>
  );
}

export function PdfPages({ url, initialPage = 1, onPageCount, onVisiblePage, onError, onLoaded, onTap }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const urlRef = useRef(url);
  const cb = useRef({ onPageCount, onVisiblePage, onError, onLoaded });
  useEffect(() => {
    cb.current = { onPageCount, onVisiblePage, onError, onLoaded };
  });
  const slotError = useCallback(() => cb.current.onError(), []);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [ratio, setRatio] = useState(1.414);
  const [width, setWidth] = useState(0);

  // 문서 읽기: 마운트 때 한 번
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    (async () => {
      const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const loading = pdfjs.getDocument({ url: urlRef.current });
      task = loading;
      const d = await loading.promise;
      if (cancelled) return;
      const first = await d.getPage(1);
      const v = first.getViewport({ scale: 1 });
      if (cancelled) return;
      setRatio(v.height / v.width);
      setDoc(d);
      cb.current.onPageCount?.(d.numPages);
      cb.current.onLoaded?.();
    })().catch(() => {
      if (!cancelled) cb.current.onError();
    });
    return () => {
      cancelled = true;
      // 문서·worker 정리(읽는 중이면 읽기도 취소된다)
      if (task) void task.destroy();
    };
  }, []);

  // 폭에 맞추기
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 화면 가운데에 걸친 쪽 번호
  const raf = useRef(0);
  const reportVisible = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      for (const slot of Array.from(el.querySelectorAll<HTMLElement>('.pdf-slot'))) {
        const r = slot.getBoundingClientRect();
        if (r.top <= mid && r.bottom >= mid) {
          cb.current.onVisiblePage(Number(slot.dataset.page));
          return;
        }
      }
    });
  }, []);

  // 처음 맞출 쪽으로 이동
  const placed = useRef(false);
  useEffect(() => {
    if (!doc || width <= 0 || placed.current) return;
    placed.current = true;
    reportVisible();
    if (initialPage > 1) scroller.current?.querySelector<HTMLElement>(`[data-page="${initialPage}"]`)?.scrollIntoView?.({ block: 'start' });
  }, [doc, width, initialPage, reportVisible]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <div ref={scroller} className="pdf-pages" onScroll={reportVisible} onClick={onTap}>
      {doc ? Array.from({ length: doc.numPages }, (_, i) => (
        <PdfPageSlot key={i + 1} doc={doc} pageNo={i + 1} width={width} ratio={ratio} onError={slotError} />
      )) : null}
    </div>
  );
}
