import { checkPasscode } from "./_auth.js";

const SYSTEM =
  "You are the nutrition engine for Plate, a personal calorie and fitness tracking app. " +
  "Only handle food identification, nutrition estimates, nutrition labels, barcodes and diet/fitness planning. " +
  "Always reply with only the JSON the request asks for, no other text.";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!checkPasscode(req, res)) return;

  const provider = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
  const apiKey = provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "missing_key" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const { prompt, image, mediaType, fast } = body || {};

  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000)
    return res.status(400).json({ error: "bad_prompt" });

  if (image && (typeof image !== "string" || image.length > 6_000_000)) return res.status(413).json({ error: "image_rejected" });
  const type = IMAGE_TYPES.has(mediaType) ? mediaType : "image/jpeg";

  if (provider === "gemini") return gemini({ apiKey, prompt, image, type, fast, res });

  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: type, data: image } });
  content.push({ type: "text", text: prompt });

  const model = fast
    ? process.env.FAST_MODEL || "claude-haiku-4-5-20251001"
    : process.env.MODEL || "claude-sonnet-5-5";

  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, max_tokens: 1500, system: SYSTEM, messages: [{ role: "user", content }] }),
    });
  } catch (e) {
    console.error("Anthropic request failed", e);
    return res.status(502).json({ error: "upstream_error" });
  }

  if (r.status === 429) return res.status(429).json({ error: "rate_limited" });
  if (!r.ok) {
    console.error("Anthropic error", r.status, await r.text());
    return res.status(502).json({ error: r.status === 400 ? "image_rejected" : "upstream_error" });
  }

  const data = await r.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  if (!text) return res.status(502).json({ error: "empty_completion" });
  return res.status(200).json({ text });
}

// ---- Google Gemini ----
async function gemini({ apiKey, prompt, image, type, fast, res }) {
  const model = fast
    ? process.env.GEMINI_FAST_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash"
    : process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: type, data: image } });
  parts.push({ text: prompt });

  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 },
      }),
    });
  } catch (e) {
    console.error("Gemini request failed", e);
    return res.status(502).json({ error: "upstream_error" });
  }
  if (r.status === 429) return res.status(429).json({ error: "rate_limited" });
  if (!r.ok) {
    console.error("Gemini error", r.status, await r.text());
    return res.status(502).json({ error: r.status === 400 ? "image_rejected" : "upstream_error" });
  }
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("\n").trim();
  if (!text) return res.status(502).json({ error: "empty_completion" });
  return res.status(200).json({ text });
}
