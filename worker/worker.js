// Hours backend — Cloudflare Worker
// Bindings (set in the Cloudflare dashboard or wrangler.toml):
//   AI              Workers AI binding (free tier)
//   KV              KV namespace for your data
//   APP_PASSWORD    secret: the password the app sends with every request
//   ALLOWED_ORIGIN  your GitHub Pages address, e.g. https://yourname.github.io
//   ANTHROPIC_API_KEY  optional secret: if set, Claude Haiku handles AI instead (better handwriting, ~$1-3/mo)

const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const COLLECTIONS = ["events", "notes"];
const DOCS = ["app/chat"];
const MAX_IMAGES = 4;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    try {
      if (!env.APP_PASSWORD) return json({ code: "not_configured", message: "APP_PASSWORD is not set on the Worker." }, 500, cors);
      if (request.headers.get("X-Hours-Key") !== env.APP_PASSWORD) {
        return json({ code: "unauthorized", message: "Wrong password." }, 401, cors);
      }

      if (url.pathname === "/api/ping") {
        return json({ ok: true, ai: env.ANTHROPIC_API_KEY ? "claude" : "workers-ai", images: true }, 200, cors);
      }

      // ---------- storage ----------
      if (url.pathname === "/api/data" && request.method === "GET") {
        const out = { collections: {}, docs: {} };
        for (const c of COLLECTIONS) out.collections[c] = (await env.KV.get("col:" + c, "json")) || [];
        for (const d of DOCS) out.docs[d] = await env.KV.get("doc:" + d, "json");
        return json(out, 200, cors);
      }
      const colMatch = url.pathname.match(/^\/api\/col\/([a-z]+)$/);
      if (colMatch && request.method === "PUT") {
        const name = colMatch[1];
        if (!COLLECTIONS.includes(name)) return json({ code: "bad_request" }, 400, cors);
        const body = await request.json();
        if (!Array.isArray(body)) return json({ code: "bad_request" }, 400, cors);
        await env.KV.put("col:" + name, JSON.stringify(body));
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === "/api/doc" && request.method === "PUT") {
        const body = await request.json();
        if (!DOCS.includes(body.path)) return json({ code: "bad_request" }, 400, cors);
        await env.KV.put("doc:" + body.path, JSON.stringify(body.data));
        return json({ ok: true }, 200, cors);
      }

      // ---------- AI ----------
      if (url.pathname === "/api/ai" && request.method === "POST") {
        const body = await request.json();
        const messages = normalizeMessages(body.messages);
        const images = (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES);
        if (!messages.length) return json({ code: "bad_request" }, 400, cors);

        const text = env.ANTHROPIC_API_KEY
          ? await runClaude(env, messages, images)
          : await runWorkersAI(env, messages, images);

        const parsed = extractJson(text);
        if (!parsed) return json({ code: "invalid_json", message: "The AI reply wasn't valid JSON.", raw: String(text).slice(0, 500) }, 502, cors);
        return json(parsed, 200, cors);
      }

      return json({ code: "not_found" }, 404, cors);
    } catch (err) {
      const code = err && err.code ? err.code : "server_error";
      return json({ code, message: String((err && err.message) || err) }, code === "rate_limited" ? 429 : 500, cors);
    }
  },
};

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = !allowed.length || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0],
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Hours-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

// Merge consecutive same-role turns and keep only user/assistant text.
function normalizeMessages(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    const role = m && m.role === "assistant" ? "assistant" : "user";
    const content = String((m && m.content) || "").slice(0, 40000);
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n\n" + content;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

const JSON_RULE = "Respond with ONLY a single valid JSON object. No markdown, no code fences, no text before or after it.";

async function runWorkersAI(env, messages, images) {
  const system = { role: "system", content: JSON_RULE };
  try {
    if (!images.length) {
      const r = await env.AI.run(TEXT_MODEL, { messages: [system, ...messages], max_tokens: 2048, temperature: 0.2 });
      return r.response;
    }
    // Attach the photos to the latest user turn in the OpenAI-style format Llama 4 Scout accepts.
    const msgs = messages.map((m) => ({ ...m }));
    const lastUser = msgs.map((m) => m.role).lastIndexOf("user");
    msgs[lastUser] = {
      role: "user",
      content: [
        { type: "text", text: msgs[lastUser].content },
        ...images.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    };
    const r = await env.AI.run(VISION_MODEL, { messages: [system, ...msgs], max_tokens: 3000, temperature: 0.1 });
    return typeof r.response === "string" ? r.response : JSON.stringify(r.response);
  } catch (err) {
    const msg = String((err && err.message) || err);
    const e = new Error(msg);
    e.code = /3036|limit|neurons|capacity|429/i.test(msg) ? "rate_limited" : "ai_error";
    throw e;
  }
}

async function runClaude(env, messages, images) {
  const msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  if (images.length) {
    const lastUser = msgs.map((m) => m.role).lastIndexOf("user");
    msgs[lastUser] = {
      role: "user",
      content: [
        ...images.map((url) => {
          const m = /^data:(image\/[a-z]+);base64,(.*)$/i.exec(url) || [];
          return { type: "image", source: { type: "base64", media_type: m[1] || "image/jpeg", data: m[2] || "" } };
        }),
        { type: "text", text: msgs[lastUser].content },
      ],
    };
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 3000, system: JSON_RULE, messages: msgs }),
  });
  const data = await res.json();
  if (!res.ok) {
    const e = new Error((data.error && data.error.message) || "Claude API error");
    e.code = res.status === 429 ? "rate_limited" : "ai_error";
    throw e;
  }
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

// Pull the first JSON object out of a model reply, tolerating code fences or stray text.
function extractJson(text) {
  if (text && typeof text === "object") return text;
  const s = String(text || "").replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(s); } catch (_) {}
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}
