import { AlertCircle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { type FocusEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import { pdfjsLib } from "../lib/pdf";

type PdfDocumentViewerProps = {
  data: ArrayBuffer;
  onPageCountChange: (pageCount: number) => void;
};

type PdfPageViewProps = {
  pageNumber: number;
  pdf: PDFDocumentProxy;
};

type PdfPagePlaceholderProps = {
  pageNumber: number;
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const pdfAssetBase = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}pdfjs/`;
const prerenderRadius = 2;

function PdfPageView({ pdf, pageNumber }: PdfPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(820);
  const [isRendering, setIsRendering] = useState(true);
  const [renderError, setRenderError] = useState("");

  useEffect(() => {
    const measureElement = measureRef.current;
    if (!measureElement) {
      return;
    }

    const updateWidth = () => {
      setAvailableWidth(Math.max(320, measureElement.clientWidth));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(measureElement);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;

    const renderPage = async () => {
      setIsRendering(true);
      setRenderError("");

      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = clamp(availableWidth - 24, 320, 940);
      const scale = clamp(targetWidth / baseViewport.width, 0.55, 2);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const pageElement = pageRef.current;
      const textLayerElement = textLayerRef.current;

      if (!canvas || !pageElement || !textLayerElement || cancelled) {
        return;
      }

      pageElement.style.setProperty("--scale-factor", String(scale));
      pageElement.style.setProperty("--user-unit", String(page.userUnit || 1));
      pageElement.style.width = `${viewport.width}px`;
      pageElement.style.height = `${viewport.height}px`;

      const pixelRatio = clamp(window.devicePixelRatio || 1, 1, 2);
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas rendering is not available in this browser.");
      }

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
      });

      await renderTask.promise;

      if (cancelled) {
        return;
      }

      textLayerElement.innerHTML = "";
      textLayerElement.style.width = `${viewport.width}px`;
      textLayerElement.style.height = `${viewport.height}px`;

      const textContent = await page.getTextContent();
      textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerElement,
        viewport,
      });
      await textLayer.render();

      if (!cancelled) {
        setIsRendering(false);
      }
    };

    void renderPage().catch((caught) => {
      if (cancelled) {
        return;
      }

      const message = caught instanceof Error ? caught.message : "PDF page render failed.";
      if (!message.includes("cancelled")) {
        setRenderError(message);
      }
      setIsRendering(false);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [availableWidth, pageNumber, pdf]);

  return (
    <div className="pdf-page-outer" ref={measureRef}>
      <div className="pdf-page-label">Page {pageNumber}</div>
      <div className="page pdf-page" ref={pageRef} data-page-number={pageNumber}>
        <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} />
        <div className="textLayer" ref={textLayerRef} />
        {isRendering && (
          <div className="pdf-page-status">
            <Loader2 className="spin" size={18} />
          </div>
        )}
        {renderError && (
          <div className="pdf-page-error">
            <AlertCircle size={18} />
            {renderError}
          </div>
        )}
      </div>
    </div>
  );
}

function PdfPagePlaceholder({ pageNumber }: PdfPagePlaceholderProps) {
  return (
    <div className="pdf-page-outer">
      <div className="pdf-page-label">Page {pageNumber}</div>
      <div className="pdf-page-placeholder" aria-label={`PDF page ${pageNumber} placeholder`} />
    </div>
  );
}

export function PdfDocumentViewer({ data, onPageCountChange }: PdfDocumentViewerProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [visiblePages, setVisiblePages] = useState<number[]>([1]);
  const [loadError, setLoadError] = useState("");
  const pageInputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const visiblePagesRef = useRef(new Set<number>([1]));

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setPageCount(0);
    setCurrentPage(1);
    setPageInput("1");
    setVisiblePages([1]);
    setLoadError("");
    pageRefs.current.clear();
    visiblePagesRef.current = new Set([1]);

    const loadingTask = pdfjsLib.getDocument({
      data: data.slice(0),
      cMapPacked: true,
      cMapUrl: `${pdfAssetBase}cmaps/`,
      iccUrl: `${pdfAssetBase}iccs/`,
      standardFontDataUrl: `${pdfAssetBase}standard_fonts/`,
      useWasm: true,
      wasmUrl: `${pdfAssetBase}wasm/`,
    });

    void loadingTask.promise
      .then((loadedPdf) => {
        if (cancelled) {
          void loadedPdf.destroy();
          return;
        }

        setPdf(loadedPdf);
        setPageCount(loadedPdf.numPages);
        setCurrentPage(1);
        setPageInput("1");
        onPageCountChange(loadedPdf.numPages);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }

        setLoadError(caught instanceof Error ? caught.message : "PDF load failed.");
      });

    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [data, onPageCountChange]);

  const pageNumbers = useMemo(() => {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }, [pageCount]);

  const renderedPageNumbers = useMemo(() => {
    const nextPages = new Set<number>();

    const addPageWindow = (pageNumber: number) => {
      for (let offset = -prerenderRadius; offset <= prerenderRadius; offset += 1) {
        const nextPage = pageNumber + offset;
        if (nextPage >= 1 && nextPage <= pageCount) {
          nextPages.add(nextPage);
        }
      }
    };

    addPageWindow(currentPage);
    visiblePages.forEach(addPageWindow);

    return nextPages;
  }, [currentPage, pageCount, visiblePages]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const scrollRoot = viewer?.closest(".document-view");

    if (!viewer || !(scrollRoot instanceof HTMLElement) || pageNumbers.length === 0) {
      return;
    }

    visiblePagesRef.current = new Set([1]);
    setVisiblePages([1]);

    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        const nextVisiblePages = new Set(visiblePagesRef.current);

        for (const entry of entries) {
          const rawPageNumber = (entry.target as HTMLElement).dataset.pageNumber;
          const pageNumber = rawPageNumber ? Number.parseInt(rawPageNumber, 10) : Number.NaN;

          if (!Number.isFinite(pageNumber)) {
            continue;
          }

          if (entry.isIntersecting) {
            if (!nextVisiblePages.has(pageNumber)) {
              nextVisiblePages.add(pageNumber);
              changed = true;
            }
          } else if (nextVisiblePages.delete(pageNumber)) {
            changed = true;
          }
        }

        if (!changed) {
          return;
        }

        visiblePagesRef.current = nextVisiblePages;
        setVisiblePages(Array.from(nextVisiblePages).sort((a, b) => a - b));
      },
      {
        root: scrollRoot,
        rootMargin: "900px 0px",
        threshold: 0.01,
      },
    );

    for (const pageNumber of pageNumbers) {
      const pageElement = pageRefs.current.get(pageNumber);
      if (pageElement) {
        observer.observe(pageElement);
      }
    }

    return () => observer.disconnect();
  }, [pageNumbers]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const scrollRoot = viewer?.closest(".document-view");

    if (!viewer || !(scrollRoot instanceof HTMLElement) || pageNumbers.length === 0) {
      return;
    }

    let animationFrame = 0;

    const updateCurrentPage = () => {
      animationFrame = 0;
      const rootRect = scrollRoot.getBoundingClientRect();
      const marker = rootRect.top + 88;
      let nextPage = currentPage;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const pageNumber of pageNumbers) {
        const pageElement = pageRefs.current.get(pageNumber);
        if (!pageElement) {
          continue;
        }

        const rect = pageElement.getBoundingClientRect();
        if (rect.bottom < rootRect.top + 64 || rect.top > rootRect.bottom) {
          continue;
        }

        const distance = Math.abs(rect.top - marker);
        if (distance < bestDistance) {
          bestDistance = distance;
          nextPage = pageNumber;
        }
      }

      setCurrentPage((previous) => {
        if (previous === nextPage) {
          return previous;
        }

        if (!document.activeElement?.closest(".pdf-jump-control")) {
          setPageInput(String(nextPage));
        }

        return nextPage;
      });
    };

    const scheduleUpdate = () => {
      if (animationFrame) {
        return;
      }

      animationFrame = window.requestAnimationFrame(updateCurrentPage);
    };

    scheduleUpdate();
    scrollRoot.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      scrollRoot.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [currentPage, pageNumbers]);

  const jumpToPage = (rawPage: string | number) => {
    const parsed = typeof rawPage === "number" ? rawPage : Number.parseInt(rawPage, 10);
    const nextPage = clamp(Number.isFinite(parsed) ? parsed : currentPage, 1, Math.max(1, pageCount));
    const pageElement = pageRefs.current.get(nextPage);
    const scrollRoot = viewerRef.current?.closest(".document-view");

    setCurrentPage(nextPage);
    setPageInput(String(nextPage));

    if (pageElement && scrollRoot instanceof HTMLElement) {
      const rootRect = scrollRoot.getBoundingClientRect();
      const pageRect = pageElement.getBoundingClientRect();
      scrollRoot.scrollTo({
        top: scrollRoot.scrollTop + pageRect.top - rootRect.top - 58,
        behavior: "smooth",
      });
    }
  };

  const handleJumpSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    jumpToPage(pageInputRef.current?.value ?? pageInput);
  };

  const handlePageInputBlur = (event: FocusEvent<HTMLInputElement>) => {
    const nextFocus = event.relatedTarget;
    if (nextFocus instanceof HTMLElement && nextFocus.closest(".pdf-jump-control")) {
      return;
    }

    setPageInput(String(currentPage));
  };

  if (loadError) {
    return (
      <div className="pdf-load-error">
        <AlertCircle size={20} />
        {loadError}
      </div>
    );
  }

  if (!pdf) {
    return (
      <div className="pdf-loading">
        <Loader2 className="spin" size={20} />
        正在加载 PDF
      </div>
    );
  }

  return (
    <div className="pdf-viewer-shell pdfViewer" ref={viewerRef}>
      <form className="pdf-jump-control" onSubmit={handleJumpSubmit}>
        <button
          className="icon-button compact"
          type="button"
          aria-label="上一页"
          title="上一页"
          onClick={() => jumpToPage(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          <ChevronLeft size={17} />
        </button>
        <label className="page-jump-field">
          <span>页码</span>
          <input
            ref={pageInputRef}
            min={1}
            max={pageCount}
            name="page"
            type="number"
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onBlur={handlePageInputBlur}
          />
        </label>
        <span className="page-total">/ {pageCount}</span>
        <button className="icon-button text-button page-jump-button" type="submit">
          跳转
        </button>
        <button
          className="icon-button compact"
          type="button"
          aria-label="下一页"
          title="下一页"
          onClick={() => jumpToPage(currentPage + 1)}
          disabled={currentPage >= pageCount}
        >
          <ChevronRight size={17} />
        </button>
      </form>
      {pageNumbers.map((pageNumber) => (
        <div
          className="pdf-page-anchor"
          data-page-number={pageNumber}
          key={pageNumber}
          ref={(element) => {
            if (element) {
              pageRefs.current.set(pageNumber, element);
            } else {
              pageRefs.current.delete(pageNumber);
            }
          }}
        >
          {renderedPageNumbers.has(pageNumber) ? (
            <PdfPageView pdf={pdf} pageNumber={pageNumber} />
          ) : (
            <PdfPagePlaceholder pageNumber={pageNumber} />
          )}
        </div>
      ))}
    </div>
  );
}
