/**
 * 谈谈在成长 · DeepSeek 代理
 *
 * 作用：把网页发来的对话请求转发给 DeepSeek API，并在服务端注入 API Key。
 * 密钥存放在 Cloudflare 的加密 Secret（DEEPSEEK_API_KEY）里，不在任何前端代码中。
 *
 * 防护：
 *  1. 只接受白名单来源（两个官网域名）的跨域请求
 *  2. 只开放 POST /v1/chat/completions 一个接口
 *  3. 模型白名单：只允许 deepseek-chat / deepseek-reasoner
 *  4. 每 IP 每分钟限流（尽力而为）
 */

const ALLOWED_ORIGINS = [
  "https://lsh-baishui.github.io",
  "https://baishui-001-d4gli52sbb9e0b855-1467916999.tcloudbaseapp.com",
];

const ALLOWED_MODELS = ["deepseek-chat", "deepseek-reasoner"];
const WINDOW_MS = 60_000;
const LIMIT_PER_MIN = 15;

/** 每个 isolate 内存里的滑动窗口限流（尽力而为） */
const hits = new Map();
function allow(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= LIMIT_PER_MIN) {
    hits.set(ip, arr);
    return false;
  }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return true;
}

function json(data, corsOrigin, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": corsOrigin || "",
      Vary: "Origin",
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "";

    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };

    // 跨域预检
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 健康检查（不做来源限制，方便页面显示服务状态）
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true }, corsOrigin);
    }

    // 业务请求：必须是白名单来源
    if (!corsOrigin) {
      return json({ error: "Forbidden: origin not allowed" }, corsOrigin, 403);
    }

    // 只开放一个接口
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return json({ error: "Not found" }, corsOrigin, 404);
    }

    // 限流
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!allow(ip)) {
      return json({ error: "请求太频繁，请休息一下再试" }, corsOrigin, 429);
    }

    // 解析并收紧请求体
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "请求体不是合法 JSON" }, corsOrigin, 400);
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return json({ error: "缺少 messages" }, corsOrigin, 400);
    }
    if (!ALLOWED_MODELS.includes(body.model)) {
      body.model = "deepseek-chat";
    }

    // 转发到 DeepSeek，注入密钥
    let upstream;
    try {
      upstream = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + env.DEEPSEEK_API_KEY,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return json({ error: "上游服务暂时不可用，请稍后重试" }, corsOrigin, 502);
    }

    // 流式透传
    const headers = new Headers(upstream.headers);
    headers.set("Access-Control-Allow-Origin", corsOrigin);
    headers.set("Vary", "Origin");
    headers.delete("content-security-policy");
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
