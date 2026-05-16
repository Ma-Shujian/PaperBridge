import {
  Check,
  Clipboard,
  Copy,
  FileText,
  Languages,
  Loader2,
  PanelRight,
  RotateCcw,
  Settings,
  Upload,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { PdfDocumentViewer } from "./components/PdfDocumentViewer";
import { readPdfDocument, readTextDocument } from "./lib/pdf";
import { translateSelection } from "./lib/translation";
import type { LoadedDocument, TranslationProvider, TranslationState } from "./types";

const sampleDocument: LoadedDocument = {
  name: "Sample: compactness and convergence",
  kind: "sample",
  pages: [
    `Let X be a compact metric space and let (f_n) be an equicontinuous sequence of real-valued functions on X. Suppose that f_n converges pointwise to a function f. Then f is continuous, and the convergence is uniform.

Proof. Fix epsilon > 0. By equicontinuity, for every x in X there exists a radius delta_x > 0 such that d(x,y) < delta_x implies |f_n(x)-f_n(y)| < epsilon/3 for all n. Since X is compact, finitely many of these balls cover X. Pointwise convergence on the finite set of centers then gives a common index N, and the triangle inequality completes the estimate.`,
  ],
};

const providerLabels: Record<TranslationProvider, string> = {
  public: "公共翻译",
  custom: "自定义端点",
  local: "本地术语",
};

const splitParagraphs = (pageText: string) => {
  const blocks = pageText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length > 1) {
    return blocks;
  }

  return pageText
    .split(/\n/)
    .map((block) => block.trim())
    .filter(Boolean);
};

const selectionBelongsTo = (container: HTMLDivElement, range: Range) => {
  const startNode =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
  const endNode =
    range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endContainer.parentElement
      : range.endContainer;

  return Boolean(startNode && endNode && container.contains(startNode) && container.contains(endNode));
};

function App() {
  const [document, setDocument] = useState<LoadedDocument>(sampleDocument);
  const [selectedText, setSelectedText] = useState("");
  const [translation, setTranslation] = useState<TranslationState | null>(null);
  const [history, setHistory] = useState<TranslationState[]>([]);
  const [provider, setProvider] = useState<TranslationProvider>("public");
  const [customEndpoint, setCustomEndpoint] = useState(() => {
    return (
      localStorage.getItem("paperbridge-custom-endpoint") ??
      localStorage.getItem("paper-lingo-custom-endpoint") ??
      ""
    );
  });
  const [draftText, setDraftText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const pageCountLabel = useMemo(() => {
    if (document.kind === "pdf") {
      return document.pageCount ? `${document.pageCount} 页` : "PDF";
    }

    return `${document.pages.join("").length.toLocaleString()} 字符`;
  }, [document]);

  const handlePdfPageCountChange = useCallback((pageCount: number) => {
    setDocument((current) => {
      if (current.kind !== "pdf" || current.pageCount === pageCount) {
        return current;
      }

      return {
        ...current,
        pageCount,
      };
    });
  }, []);

  const runTranslation = useCallback(
    async (text: string) => {
      const normalized = text.replace(/\s+/g, " ").trim();
      if (normalized.length < 2) {
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setSelectedText(normalized);
      setIsTranslating(true);
      setError("");

      try {
        const result = await translateSelection(normalized, {
          provider,
          customEndpoint,
        });

        if (requestIdRef.current !== requestId) {
          return;
        }

        const next: TranslationState = {
          source: normalized,
          translated: result.translated,
          provider: result.provider,
          at: Date.now(),
        };

        setTranslation(next);
        setHistory((items) => [
          next,
          ...items.filter((item) => item.source !== normalized).slice(0, 7),
        ]);
      } catch (caught) {
        if (requestIdRef.current !== requestId) {
          return;
        }

        setError(caught instanceof Error ? caught.message : "翻译失败");
      } finally {
        if (requestIdRef.current === requestId) {
          setIsTranslating(false);
        }
      }
    },
    [customEndpoint, provider],
  );

  const handleSelection = useCallback(() => {
    const selection = window.getSelection();
    const container = documentRef.current;

    if (!selection || selection.isCollapsed || !container || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!selectionBelongsTo(container, range)) {
      return;
    }

    void runTranslation(selection.toString());
  }, [runTranslation]);

  const handleFile = async (file: File) => {
    setIsLoadingDocument(true);
    setError("");

    try {
      const nextDocument =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
          ? await readPdfDocument(file)
          : await readTextDocument(file);

      setDocument(nextDocument);
      setSelectedText("");
      setTranslation(null);
      setHistory([]);
      window.getSelection()?.removeAllRanges();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文献读取失败");
    } finally {
      setIsLoadingDocument(false);
    }
  };

  const loadDraftText = () => {
    const text = draftText.trim();
    if (!text) {
      return;
    }

    setDocument({
      name: "Pasted text",
      kind: "text",
      pages: [text],
    });
    setSelectedText("");
    setTranslation(null);
    setHistory([]);
  };

  const resetToSample = () => {
    setDocument(sampleDocument);
    setDraftText("");
    setSelectedText("");
    setTranslation(null);
    setHistory([]);
    setError("");
  };

  const updateCustomEndpoint = (value: string) => {
    setCustomEndpoint(value);
    localStorage.setItem("paperbridge-custom-endpoint", value);
  };

  const copyTranslation = async () => {
    if (!translation?.translated) {
      return;
    }

    await navigator.clipboard.writeText(translation.translated);
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1400);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Languages size={22} />
          </div>
          <div>
            <h1>PaperBridge</h1>
            <p>在原始 PDF 页面上选中文本，右栏自动生成中文译文</p>
          </div>
        </div>

        <div className="topbar-actions">
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept=".pdf,.txt,.md,text/plain,application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleFile(file);
              }
              event.currentTarget.value = "";
            }}
          />
          <button className="icon-button text-button" onClick={() => fileInputRef.current?.click()}>
            <Upload size={18} />
            打开文献
          </button>
          <button className="icon-button" aria-label="恢复示例" title="恢复示例" onClick={resetToSample}>
            <RotateCcw size={18} />
          </button>
          <button
            className={`icon-button ${settingsOpen ? "is-active" : ""}`}
            aria-label="翻译设置"
            title="翻译设置"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {settingsOpen && (
        <section className="settings-panel" aria-label="翻译设置">
          <div className="segmented-control" role="group" aria-label="翻译引擎">
            {(["public", "custom", "local"] as TranslationProvider[]).map((item) => (
              <button
                key={item}
                className={provider === item ? "is-selected" : ""}
                onClick={() => setProvider(item)}
              >
                {providerLabels[item]}
              </button>
            ))}
          </div>
          <label className="endpoint-field">
            <span>端点</span>
            <input
              value={customEndpoint}
              onChange={(event) => updateCustomEndpoint(event.target.value)}
              placeholder="https://your-server.example/translate"
              disabled={provider !== "custom"}
            />
          </label>
          <p className="privacy-note">
            公共翻译会把选中文本发送到 MyMemory；自定义端点使用 POST JSON：text、sourceLanguage、targetLanguage。
          </p>
        </section>
      )}

      <section className="workspace" aria-label="文献翻译工作区">
        <section className="reader-pane" aria-label="文献原文">
          <div className="pane-header">
            <div>
              <span className="eyebrow">原文</span>
              <h2>{document.name}</h2>
            </div>
            <div className="document-meta">
              <FileText size={16} />
              {isLoadingDocument ? "读取中" : pageCountLabel}
            </div>
          </div>

          {document.kind !== "pdf" && (
            <div className="paste-strip">
              <textarea
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                placeholder="也可以直接粘贴英文文献片段"
                rows={3}
              />
              <button className="icon-button text-button" onClick={loadDraftText} disabled={!draftText.trim()}>
                <Clipboard size={17} />
                载入文本
              </button>
            </div>
          )}

          <article
            ref={documentRef}
            className={`document-view ${document.kind === "pdf" ? "document-view-pdf" : ""}`}
            onMouseUp={handleSelection}
            onKeyUp={handleSelection}
            tabIndex={0}
          >
            {document.kind === "pdf" && document.pdfData ? (
              <PdfDocumentViewer data={document.pdfData} onPageCountChange={handlePdfPageCountChange} />
            ) : (
              document.pages.map((page, pageIndex) => (
                <section className="page-block" key={`${document.name}-${pageIndex}`}>
                  {splitParagraphs(page).map((paragraph, paragraphIndex) => (
                    <p key={`${pageIndex}-${paragraphIndex}`}>{paragraph}</p>
                  ))}
                </section>
              ))
            )}
          </article>
        </section>

        <aside className="translation-pane" aria-label="中文译文">
          <div className="pane-header">
            <div>
              <span className="eyebrow">译文</span>
              <h2>中文辅助阅读</h2>
            </div>
            <div className="document-meta">
              <PanelRight size={16} />
              {providerLabels[translation?.provider ?? provider]}
            </div>
          </div>

          <div className="translation-current">
            <div className="section-title">
              <span>当前选区</span>
              {isTranslating && <Loader2 className="spin" size={17} />}
            </div>
            <div className="source-box">
              {selectedText || "在左栏 PDF 页面或文本中选择一句或一段英文文献。"}
            </div>

            <div className="section-title">
              <span>中文译文</span>
              <button
                className="icon-button compact"
                aria-label="复制译文"
                title="复制译文"
                onClick={copyTranslation}
                disabled={!translation?.translated}
              >
                {copyState === "copied" ? <Check size={17} /> : <Copy size={17} />}
              </button>
            </div>

            <div className={`translation-box ${error ? "has-error" : ""}`}>
              {error ||
                translation?.translated ||
                (isTranslating ? "正在翻译..." : "译文会显示在这里。")}
            </div>
          </div>

          <div className="history-panel">
            <div className="section-title">
              <span>历史</span>
              <span className="counter">{history.length}</span>
            </div>
            <div className="history-list">
              {history.length === 0 && <div className="empty-history">还没有翻译记录。</div>}
              {history.map((item) => (
                <button
                  className="history-item"
                  key={`${item.at}-${item.source}`}
                  onClick={() => {
                    setSelectedText(item.source);
                    setTranslation(item);
                    setError("");
                  }}
                >
                  <span>{item.source}</span>
                  <strong>{item.translated}</strong>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

export default App;
