import http from "node:http";

const port = Number.parseInt(
  process.env.PAPERBRIDGE_TRANSLATE_PORT ?? process.env.PAPERLINGO_TRANSLATE_PORT ?? "8787",
  10,
);
const model = process.env.OPENAI_TRANSLATION_MODEL ?? "gpt-5.4-mini";
const apiKey = process.env.OPENAI_API_KEY;
const allowedOrigin =
  process.env.PAPERBRIDGE_ORIGIN ?? process.env.PAPERLINGO_ORIGIN ?? "*";

const jsonHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": allowedOrigin,
  "Content-Type": "application/json; charset=utf-8",
};

const readRequestBody = (request) =>
  new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 200_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, jsonHeaders);
  response.end(JSON.stringify(payload));
};

const extractOutputText = (payload) => {
  if (typeof payload.output_text === "string") {
    return payload.output_text.trim();
  }

  const parts = [];

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
};

const mathInstructions = [
  "You are a precise academic translator.",
  "Translate English mathematical literature into Simplified Chinese.",
  "Return only the translation. Do not explain, summarize, expand proof steps, or add extra sections.",
  "Preserve formulas, variables, Greek letters, subscripts, superscripts, citations, and equation references exactly.",
  "Preserve labels such as Theorem 2.1, Lemma 3, Definition 1.4, Proposition, Corollary, and Proof with their numbering.",
  "Do not translate or rewrite symbols such as X_t, \\mathcal{F}_t, \\epsilon, alpha, beta, mu, sigma, or expressions in TeX delimiters.",
  "Use standard Simplified Chinese mathematical terminology consistently.",
].join(" ");

const generalInstructions =
  "You are a precise academic translator. Translate English academic text into Simplified Chinese. Return only the translation.";

const translateWithOpenAI = async (text, mathMode) => {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: mathMode ? mathInstructions : generalInstructions,
      input: text,
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    const message = payload.error?.message ?? `OpenAI API returned ${response.status}`;
    throw new Error(message);
  }

  const translation = extractOutputText(payload);
  if (!translation) {
    throw new Error("OpenAI response did not include translated text.");
  }

  return translation;
};

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, jsonHeaders);
    response.end();
    return;
  }

  if (request.method !== "POST" || request.url !== "/translate") {
    sendJson(response, 404, { error: "Use POST /translate." });
    return;
  }

  if (!apiKey) {
    sendJson(response, 500, { error: "Set OPENAI_API_KEY before starting this server." });
    return;
  }

  try {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || "{}");
    const text = String(payload.text ?? "").trim();
    const mathMode = payload.mathMode !== false && payload.mode !== "general";

    if (!text) {
      sendJson(response, 400, { error: "Missing text." });
      return;
    }

    const translation = await translateWithOpenAI(text, mathMode);
    sendJson(response, 200, { translation });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Translation failed.",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`PaperBridge OpenAI translation endpoint: http://127.0.0.1:${port}/translate`);
  console.log(`Model: ${model}`);
});
