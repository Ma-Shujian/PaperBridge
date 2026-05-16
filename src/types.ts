export type LoadedDocument = {
  name: string;
  kind: "sample" | "pdf" | "text";
  pages: string[];
  pdfData?: ArrayBuffer;
  pageCount?: number;
};

export type TranslationProvider = "public" | "custom" | "local";

export type TranslationState = {
  source: string;
  translated: string;
  provider: TranslationProvider;
  at: number;
};
