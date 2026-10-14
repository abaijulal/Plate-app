import { checkPasscode } from "./_auth.js";

// Plans can take a while when the model thinks first; retries need headroom too.
export const config = { maxDuration: 60 };

const SYSTEM =
  "You are the nutrition engine for Plate, a personal calorie and fitness tracking app. " +
  "Only handle food identification, nutrition estimates, nutrition labels, barcodes and diet/fitness planning. " +
  "Always reply with only the JSON the request asks for, no other text.";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DEADLINE_MS = 50_000; // stop retrying before Vercel's 60s limit

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!checkPasscode(req, res)) return;

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const { prompt, image, mediaType, fast } = body || {};
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000)
    return res.status(400).json({ error: "bad_prompt" });
  if (image && (typeof image !== "string" || image.length > 6_000_000))
    return res.status(413).json({ error: "image_rejected" });
  const type = IMAGE_TYPES.has(mediaType) ? mediaType : "image/jpeg";

  // Build the list of things to try, in order. Each gets a couple of retries.
  const primary = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
  const plan = [];
  const gem = (model) => process.env.GEMINI_API_KEY && plan.push({ provider: "gemini", model });
  const ant = (model) => process.env.ANTHROPIC_API_KEY && plan.push({ provider: "anthropic", model });
  const gModel = fast ? process.env.GEMINI_FAST_MODEL || process.env.GEMINI_MODEL || "gemini-3.5-flash" : process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const aModel = fast ? process.env.FAST_MODEL || "claude-haiku-4-5-20251001" : process.env.MODEL || "claude-sonnet-5-5";
  if (primary === "gemini") {
    gem(gModel);
    if (process.env.GEMINI_FALLBACK_MODEL) gem(process.env.GEMINI_FALLBACK_MODEL);
    ant(aModel); // only used if you also set ANTHROPIC_API_KEY
  } else {
    ant(aModel);
    gem(gModel);
  }
  if (!plan.length) return res.status(500).json({ error: "missing_key" });

  const started = Date.now();
  let last = { status: 502, error: "upstream_error" };

  for (const step of plan) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() - started > DEADLINE_MS) break;
      const out = step.provider === "gemini"
        ? await callGemini(step.model, prompt, image, type)
        : await callAnthropic(step.model, prompt, image, type);
      if (out.text) {
        if (attempt > 0 || step !== plan[0]) console.log(`Recovered via ${step.provider}/${step.model} on attempt ${attempt + 1}`);
        return res.status(200).json({ text: out.text });
      }
      last = out;
      console.error(`${step.provider}/${step.model} attempt ${attempt + 1} failed:`, out.status, out.detail || "");
      if (!out.retryable) break; // e.g. bad key or bad image: retrying won't help
      await sleep(800 * 2 ** attempt + Math.random() * 400); // ~0.8s, 1.6s, 3.2s
    }
  }
  return res.status(last.status === 429 ? 429 : 502).json({ error: last.status === 429 ? "rate_limited" : last.error });
}

async function callAnthropic(model, prompt, image, type) {
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: type, data: image } });
  content.push({ type: "text", text: prompt });
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1500, system: SYSTEM, messages: [{ role: "user", content }] }),
    });
  } catch (e) {
    return { retryable: true, status: 502, error: "upstream_error", detail: String(e) };
  }
  if (!r.ok) return fail(r);
  const data = await r.json().catch(() => ({}));
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  return text ? { text } : { retryable: true, status: 502, error: "empty_completion", detail: data.stop_reason };
}

async function callGemini(model, prompt, image, type) {
  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: type, data: image } });
  parts.push({ text: prompt });
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 16384 },
      }),
    });
  } catch (e) {
    return { retryable: true, status: 502, error: "upstream_error", detail: String(e) };
  }
  if (!r.ok) return fail(r);
  const data = await r.json().catch(() => ({}));
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("\n").trim();
  return text ? { text } : { retryable: true, status: 502, error: "empty_completion", detail: JSON.stringify({ finish: cand?.finishReason, block: data.promptFeedback }) };
}

async function fail(r) {
  const detail = (await r.text().catch(() => "")).slice(0, 500);
  return {
    retryable: RETRYABLE.has(r.status),
    status: r.status,
    error: r.status === 400 ? "image_rejected" : r.status === 429 ? "rate_limited" : "upstream_error",
    detail,
  };
}
