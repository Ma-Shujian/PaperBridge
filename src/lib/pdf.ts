import * as pdfjsLib from "pdfjs-dist";
import type { LoadedDocument } from "../types";

const pdfAssetBase = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}pdfjs/`;

pdfjsLib.GlobalWorkerOptions.workerSrc = `${pdfAssetBase}pdf.worker.min.mjs`;

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
