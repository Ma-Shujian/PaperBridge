type PdfTextItem = {
  centerY: number;
  height: number;
  left: number;
  right: number;
  text: string;
  top: number;
};

const maxCoordinateRepairItems = 300;
const shortScriptPattern = /^[A-Za-z0-9+\-=(),.α-ωΑ-Ωϵε]+$/;
const mathBasePattern = /[A-Za-z0-9α-ωΑ-Ωϵε)\]}]$/;

const normalizeInlineText = (text: string) => text.replace(/\s+/g, " ");

const textNodeIn = (element: HTMLElement) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  return walker.nextNode();
};

const selectedTextInSpan = (span: HTMLSpanElement, range: Range) => {
  const node = textNodeIn(span);
  const text = node?.textContent ?? span.textContent ?? "";
  if (!node) {
    return text;
  }

  let start = 0;
  let end = text.length;

  if (range.startContainer === node) {
    start = Math.min(range.startOffset, text.length);
  }

  if (range.endContainer === node) {
    end = Math.min(range.endOffset, text.length);
  }

  if (start > end) {
    return "";
  }

  return text.slice(start, end);
};

const intersectsRange = (range: Range, element: HTMLElement) => {
  try {
    return range.intersectsNode(element);
  } catch {
    return false;
  }
};

const isPdfTextSelection = (range: Range) => {
  const startElement =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
  const endElement =
    range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : range.endContainer;

  return Boolean(
    startElement instanceof HTMLElement &&
      endElement instanceof HTMLElement &&
      startElement.closest(".textLayer") &&
      endElement.closest(".textLayer"),
  );
};

const collectSelectedPdfTextItems = (range: Range, root: HTMLElement) => {
  const spans = Array.from(root.querySelectorAll<HTMLSpanElement>(".textLayer span"));
  const items: PdfTextItem[] = [];

  for (const span of spans) {
    if (!intersectsRange(range, span)) {
      continue;
    }

    const text = normalizeInlineText(selectedTextInSpan(span, range));
    if (!text.trim()) {
      continue;
    }

    const rect = span.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    items.push({
      centerY: rect.top + rect.height / 2,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      text,
      top: rect.top,
    });

    if (items.length > maxCoordinateRepairItems) {
      return [];
    }
  }

  return items;
};

const scriptMarkerBetween = (base: PdfTextItem, candidate: PdfTextItem) => {
  const scriptText = candidate.text.trim();
  const baseText = base.text.trim();
  const horizontalGap = candidate.left - base.right;
  const verticalDelta = candidate.centerY - base.centerY;
  const maxGap = Math.max(8, base.height * 0.75);
  const minVerticalDelta = Math.max(1.5, base.height * 0.12);

  if (!scriptText || scriptText.length > 6 || !shortScriptPattern.test(scriptText)) {
    return "";
  }

  if (!mathBasePattern.test(baseText) || candidate.height > base.height * 0.92) {
    return "";
  }

  if (horizontalGap < -base.height * 0.35 || horizontalGap > maxGap) {
    return "";
  }

  if (Math.abs(verticalDelta) < minVerticalDelta) {
    return "";
  }

  return verticalDelta > 0 ? "_" : "^";
};

const shouldStartNewLine = (previous: PdfTextItem, current: PdfTextItem) => {
  const lineThreshold = Math.max(previous.height, current.height) * 0.85;
  return current.top > previous.top + lineThreshold && current.left < previous.right;
};

const shouldInsertSpace = (previous: PdfTextItem, current: PdfTextItem) => {
  const previousText = previous.text.trimEnd();
  const currentText = current.text.trimStart();
  const horizontalGap = current.left - previous.right;

  if (!previousText || !currentText || /\s$/.test(previous.text) || /^\s/.test(current.text)) {
    return false;
  }

  if (/^[,.;:!?，。；：！？)\]}]/.test(currentText) || /[(\[{]$/.test(previousText)) {
    return false;
  }

  return horizontalGap > Math.max(2, previous.height * 0.16);
};

const buildCoordinateRepairedText = (items: PdfTextItem[]) => {
  let repaired = "";
  let previous: PdfTextItem | null = null;
  let didRepair = false;

  for (const item of items) {
    const text = item.text.trim();
    if (!text) {
      continue;
    }

    if (!previous) {
      repaired += text;
      previous = item;
      continue;
    }

    const scriptMarker = scriptMarkerBetween(previous, item);
    if (scriptMarker) {
      repaired += `${scriptMarker}${text}`;
      didRepair = true;
      previous = item;
      continue;
    }

    if (shouldStartNewLine(previous, item)) {
      repaired += "\n";
    } else if (shouldInsertSpace(previous, item)) {
      repaired += " ";
    }

    repaired += text;
    previous = item;
  }

  return {
    didRepair,
    text: repaired.replace(/[ \t]+/g, " ").trim(),
  };
};

export const getMathAwarePdfSelectionText = (
  selection: Selection,
  range: Range,
  root: HTMLElement,
) => {
  const fallbackText = selection.toString();

  if (!isPdfTextSelection(range)) {
    return fallbackText;
  }

  const items = collectSelectedPdfTextItems(range, root);
  if (items.length === 0) {
    return fallbackText;
  }

  const repaired = buildCoordinateRepairedText(items);
  if (!repaired.didRepair || repaired.text.length < Math.max(2, fallbackText.trim().length * 0.45)) {
    return fallbackText;
  }

  return repaired.text;
};
