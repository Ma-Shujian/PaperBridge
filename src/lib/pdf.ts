import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { LoadedDocument } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export { pdfjsLib };

export const readPdfDocument = async (file: File): Promise<LoadedDocument> => {
  const buffer = await file.arrayBuffer();

  return {
    name: file.name,
    kind: "pdf",
    pages: [],
    pdfData: buffer,
  };
};

export const readTextDocument = async (file: File): Promise<LoadedDocument> => {
  const text = await file.text();

  return {
    name: file.name,
    kind: "text",
    pages: [text.trim()],
  };
};
