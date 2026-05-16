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

const translateWithOpenAI = async (text) => {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions:
        "You are a precise academic translator. Translate English mathematical literature into Simplified Chinese. Preserve formulas, symbols, theorem labels, citations, and variable names. Return only the translation.",
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

    if (!text) {
      sendJson(response, 400, { error: "Missing text." });
      return;
    }

    const translation = await translateWithOpenAI(text);
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
