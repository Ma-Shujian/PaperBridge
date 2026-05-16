import { AlertCircle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const pdfAssetBase = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}pdfjs/`;

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

export function PdfDocumentViewer({ data, onPageCountChange }: PdfDocumentViewerProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [loadError, setLoadError] = useState("");
  const pageInputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setPageCount(0);
    setLoadError("");

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
            onBlur={() => setPageInput(String(currentPage))}
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
          key={pageNumber}
          ref={(element) => {
            if (element) {
              pageRefs.current.set(pageNumber, element);
            } else {
              pageRefs.current.delete(pageNumber);
            }
          }}
        >
          <PdfPageView pdf={pdf} pageNumber={pageNumber} />
        </div>
      ))}
    </div>
  );
}
