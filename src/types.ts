export type LoadedDocument = {
  name: string;
  kind: "sample" | "pdf" | "text";
  pages: string[];
  pdfData?: ArrayBuffer;
  pageCount?: number;
};

export type TranslationProvider = "public" | "custom" | "local";

export type TranslationMode = "general" | "math";

export type TranslationState = {
  source: string;
  translated: string;
  provider: TranslationProvider;
  mode: TranslationMode;
  at: number;
};
