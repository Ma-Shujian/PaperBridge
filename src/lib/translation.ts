import type { TranslationProvider } from "../types";

export type TranslateOptions = {
  provider: TranslationProvider;
  customEndpoint: string;
};

export type TranslateResult = {
  translated: string;
  provider: TranslationProvider;
};

const glossary: Array<[RegExp, string]> = [
  [/\btheorem\b/gi, "定理"],
  [/\blemma\b/gi, "引理"],
  [/\bcorollary\b/gi, "推论"],
  [/\bproof\b/gi, "证明"],
  [/\bdefinition\b/gi, "定义"],
  [/\bassumption\b/gi, "假设"],
  [/\bproposition\b/gi, "命题"],
  [/\bsequence\b/gi, "序列"],
  [/\bfunction\b/gi, "函数"],
  [/\bcontinuous\b/gi, "连续"],
  [/\bdifferentiable\b/gi, "可微"],
  [/\bcompact\b/gi, "紧"],
  [/\bconverges?\b/gi, "收敛"],
  [/\bbounded\b/gi, "有界"],
  [/\bmeasure\b/gi, "测度"],
  [/\bintegral\b/gi, "积分"],
  [/\bmatrix\b/gi, "矩阵"],
  [/\bvector\b/gi, "向量"],
  [/\bspace\b/gi, "空间"],
  [/\bthere exists\b/gi, "存在"],
  [/\bfor all\b/gi, "对所有"],
  [/\bif and only if\b/gi, "当且仅当"],
];

const cache = new Map<string, TranslateResult>();

const normalizeText = (text: string) => {
  return text.replace(/\s+/g, " ").trim();
};

const fallbackTranslate = (text: string) => {
  let translated = normalizeText(text);

  for (const [pattern, replacement] of glossary) {
    translated = translated.replace(pattern, replacement);
  }

  return `本地术语辅助译文：${translated}`;
};

const decodeHtmlEntities = (value: string) => {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
};

const splitIntoChunks = (text: string, maxLength = 430) => {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = `${current} ${sentence}`.trim();
    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (sentence.length <= maxLength) {
      current = sentence.trim();
    } else {
      for (let index = 0; index < sentence.length; index += maxLength) {
        chunks.push(sentence.slice(index, index + maxLength).trim());
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const translatePublicChunk = async (text: string) => {
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", "en|zh-CN");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`公共翻译服务返回 ${response.status}`);
  }

  const data = (await response.json()) as {
    responseData?: {
      translatedText?: string;
    };
    responseStatus?: number;
    responseDetails?: string;
  };

  const translated = data.responseData?.translatedText?.trim();
  if (!translated) {
    throw new Error(data.responseDetails || "公共翻译服务没有返回译文");
  }

  return decodeHtmlEntities(translated);
};

const translateWithPublicApi = async (text: string) => {
  const chunks = splitIntoChunks(text);
  const translatedChunks: string[] = [];

  for (const chunk of chunks) {
    translatedChunks.push(await translatePublicChunk(chunk));
  }

  return translatedChunks.join("");
};

const translateWithCustomEndpoint = async (text: string, endpoint: string) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
    }),
  });

  if (!response.ok) {
    throw new Error(`自定义翻译端点返回 ${response.status}`);
  }

  const data = (await response.json()) as {
    translation?: string;
    translatedText?: string;
    text?: string;
  };

  const translated = data.translation ?? data.translatedText ?? data.text;
  if (!translated) {
    throw new Error("自定义端点需要返回 translation、translatedText 或 text 字段");
  }

  return translated.trim();
};

export const translateSelection = async (
  rawText: string,
  options: TranslateOptions,
): Promise<TranslateResult> => {
  const text = normalizeText(rawText);
  const cacheKey = `${options.provider}:${options.customEndpoint}:${text}`;
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  let result: TranslateResult;

  if (options.provider === "custom" && options.customEndpoint.trim()) {
    result = {
      translated: await translateWithCustomEndpoint(text, options.customEndpoint.trim()),
      provider: "custom",
    };
  } else if (options.provider === "public") {
    try {
      result = {
        translated: await translateWithPublicApi(text),
        provider: "public",
      };
    } catch {
      result = {
        translated: fallbackTranslate(text),
        provider: "local",
      };
    }
  } else {
    result = {
      translated: fallbackTranslate(text),
      provider: "local",
    };
  }

  cache.set(cacheKey, result);
  return result;
};
