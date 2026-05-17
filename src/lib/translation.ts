import type { TranslationMode, TranslationProvider } from "../types";

export type TranslateOptions = {
  provider: TranslationProvider;
  customEndpoint: string;
  mode: TranslationMode;
};

export type TranslateResult = {
  translated: string;
  provider: TranslationProvider;
};

type ProtectedSegment = {
  token: string;
  value: string;
};

const mathInstructions = [
  "Translate English mathematical literature into Simplified Chinese.",
  "Return only the translation. Do not explain, summarize, expand proof steps, or add extra sections.",
  "Preserve formulas, variables, Greek letters, subscripts, superscripts, citations, and equation references exactly.",
  "Preserve labels such as Theorem 2.1, Lemma 3, Definition 1.4, Proposition, Corollary, and Proof with their numbering.",
  "Do not translate or rewrite symbols such as X_t, \\mathcal{F}_t, \\epsilon, alpha, beta, mu, sigma, or expressions in TeX delimiters.",
  "Use standard Simplified Chinese mathematical terminology consistently.",
].join(" ");

const mathGlossary: Array<[RegExp, string]> = [
  [/\bif and only if\b/gi, "当且仅当"],
  [/\balmost surely\b/gi, "几乎必然"],
  [/\bwith probability one\b/gi, "以概率一"],
  [/\bpointwise convergence\b/gi, "逐点收敛"],
  [/\buniform convergence\b/gi, "一致收敛"],
  [/\bweak convergence\b/gi, "弱收敛"],
  [/\bin distribution\b/gi, "依分布"],
  [/\bin probability\b/gi, "依概率"],
  [/\bin measure\b/gi, "依测度"],
  [/\bequicontinuous\b/gi, "等度连续"],
  [/\bcompact metric space\b/gi, "紧度量空间"],
  [/\bcompact set\b/gi, "紧集"],
  [/\bmetric space\b/gi, "度量空间"],
  [/\btopological space\b/gi, "拓扑空间"],
  [/\bcompactness\b/gi, "紧性"],
  [/\bcompact\b/gi, "紧"],
  [/\bmeasurable\b/gi, "可测"],
  [/\bfiltration\b/gi, "滤过"],
  [/\bsigma-algebra\b/gi, "σ-代数"],
  [/\bsigma algebra\b/gi, "σ-代数"],
  [/\brandom variable\b/gi, "随机变量"],
  [/\brandom variables\b/gi, "随机变量"],
  [/\bstochastic process\b/gi, "随机过程"],
  [/\bmartingale\b/gi, "鞅"],
  [/\bsubsequence\b/gi, "子列"],
  [/\bsequence\b/gi, "序列"],
  [/\bcontinuous\b/gi, "连续"],
  [/\bdifferentiable\b/gi, "可微"],
  [/\bconverges?\b/gi, "收敛"],
  [/\bbounded\b/gi, "有界"],
  [/\bmeasure\b/gi, "测度"],
  [/\bintegral\b/gi, "积分"],
  [/\bmatrix\b/gi, "矩阵"],
  [/\bvector\b/gi, "向量"],
  [/\bspace\b/gi, "空间"],
  [/\bthere exists\b/gi, "存在"],
  [/\bfor all\b/gi, "对所有"],
];

const chineseMathTermFixes: Array<[RegExp, string]> = [
  [/紧凑度量空间/g, "紧度量空间"],
  [/紧凑空间/g, "紧空间"],
  [/几乎肯定/g, "几乎必然"],
  [/几乎确定/g, "几乎必然"],
  [/点态收敛/g, "逐点收敛"],
  [/均匀收敛/g, "一致收敛"],
  [/等连续/g, "等度连续"],
  [/过滤/g, "滤过"],
  [/西格玛代数/g, "σ-代数"],
];

const cache = new Map<string, TranslateResult>();

const normalizeText = (text: string) => {
  return text.replace(/\s+/g, " ").trim();
};

const applyMathGlossary = (text: string) => {
  let nextText = text;

  for (const [pattern, replacement] of mathGlossary) {
    nextText = nextText.replace(pattern, replacement);
  }

  return nextText;
};

const standardizeChineseMathTerms = (text: string) => {
  let nextText = text;

  for (const [pattern, replacement] of chineseMathTermFixes) {
    nextText = nextText.replace(pattern, replacement);
  }

  return nextText;
};

const protectMathSegments = (text: string) => {
  const segments: ProtectedSegment[] = [];
  let protectedText = text;

  const protect = (pattern: RegExp) => {
    protectedText = protectedText.replace(pattern, (match) => {
      if (!match.trim()) {
        return match;
      }

      const existing = segments.find((segment) => segment.value === match);
      if (existing) {
        return existing.token;
      }

      const token = `[[PBMATH_${segments.length}]]`;
      segments.push({ token, value: match });
      return token;
    });
  };

  protect(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g);
  protect(/\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g);
  protect(
    /\b(?:Theorem|Lemma|Definition|Proof|Proposition|Corollary|Remark|Example|Assumption|Equation)\s*\d*(?:\.\d+)*(?:\s*\([^)]+\))?\.?/g,
  );
  protect(/\\mathcal\{[A-Za-z]\}(?:[_^](?:\{[^{}]+\}|[A-Za-z0-9]+))*/g);
  protect(/\\[A-Za-z]+(?:\{[^{}]*\})?(?:[_^](?:\{[^{}]+\}|[A-Za-z0-9]+))*/g);
  protect(/\b[A-Za-z](?:[_^](?:\{[^{}]+\}|[A-Za-z0-9]+))+\b/g);
  protect(
    /\b(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega)\b/gi,
  );
  protect(/\b(?:X|Y|Z|W|U|V|M|N|K|T|S|F|G|H|P|Q|R)\b/g);
  protect(/[α-ωΑ-Ωϵε∈∉∀∃∑∏∫∞≤≥≠≈≡⊂⊆⊃⊇∪∩→↦⇒⇔]+(?:[_^](?:\{[^{}]+\}|[A-Za-z0-9]+))*/g);

  return {
    text: protectedText,
    segments,
  };
};

const restoreMathSegments = (text: string, segments: ProtectedSegment[]) => {
  let restored = text;

  for (const { token, value } of segments) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    restored = restored.replace(new RegExp(escapedToken, "g"), value);
  }

  return restored;
};

const preparePublicMathText = (text: string) => {
  const protectedSource = protectMathSegments(text);

  return {
    text: applyMathGlossary(protectedSource.text),
    segments: protectedSource.segments,
  };
};

const fallbackTranslate = (text: string, mode: TranslationMode) => {
  const normalized = normalizeText(text);

  if (mode === "math") {
    const { text: protectedText, segments } = protectMathSegments(normalized);
    const translated = restoreMathSegments(applyMathGlossary(protectedText), segments);
    return `本地术语辅助译文：${standardizeChineseMathTerms(translated)}`;
  }

  return `本地辅助译文：${normalized}`;
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

const translateWithPublicApi = async (text: string, mode: TranslationMode) => {
  const prepared = mode === "math" ? preparePublicMathText(text) : { text, segments: [] };
  const chunks = splitIntoChunks(prepared.text);
  const translatedChunks: string[] = [];

  for (const chunk of chunks) {
    translatedChunks.push(await translatePublicChunk(chunk));
  }

  const translated = restoreMathSegments(translatedChunks.join(""), prepared.segments);
  return mode === "math" ? standardizeChineseMathTerms(translated) : translated;
};

const translateWithCustomEndpoint = async (
  text: string,
  endpoint: string,
  mode: TranslationMode,
) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      mode,
      mathMode: mode === "math",
      instructions: mode === "math" ? mathInstructions : undefined,
      glossary:
        mode === "math"
          ? mathGlossary.map(([pattern, replacement]) => ({
              pattern: pattern.source,
              replacement,
            }))
          : undefined,
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

  return mode === "math" ? standardizeChineseMathTerms(translated.trim()) : translated.trim();
};

export const translateSelection = async (
  rawText: string,
  options: TranslateOptions,
): Promise<TranslateResult> => {
  const text = normalizeText(rawText);
  const cacheKey = `${options.provider}:${options.customEndpoint}:${options.mode}:${text}`;
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  let result: TranslateResult;

  if (options.provider === "custom" && options.customEndpoint.trim()) {
    result = {
      translated: await translateWithCustomEndpoint(text, options.customEndpoint.trim(), options.mode),
      provider: "custom",
    };
  } else if (options.provider === "public") {
    try {
      result = {
        translated: await translateWithPublicApi(text, options.mode),
        provider: "public",
      };
    } catch {
      result = {
        translated: fallbackTranslate(text, options.mode),
        provider: "local",
      };
    }
  } else {
    result = {
      translated: fallbackTranslate(text, options.mode),
      provider: "local",
    };
  }

  cache.set(cacheKey, result);
  return result;
};
