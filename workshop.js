/* ============================================================
   AI 自媒体工作坊 — DeepSeek 驱动的四个爆款助手
   调用链：网页 → 代理（腾讯云函数 / Cloudflare Worker）→ DeepSeek
   API Key 只存在于两个代理的服务端，不出现在任何网页代码中。
   ============================================================ */

(function () {
  "use strict";

  // 双通道：国内优先走腾讯云函数（直连快），备用/海外走 Cloudflare Worker。
  // 任一通道网络不通时自动切换到另一个。
  const PROXIES = [
    {
      name: "腾讯云通道",
      chat: "https://baishui-001-d4gli52sbb9e0b855.service.tcloudbase.com/deepseek-proxy",
      health: "https://baishui-001-d4gli52sbb9e0b855.service.tcloudbase.com/deepseek-proxy/health",
    },
    {
      name: "Cloudflare 通道",
      chat: "https://tantan-deepseek-proxy.lsh-baishui.workers.dev/v1/chat/completions",
      health: "https://tantan-deepseek-proxy.lsh-baishui.workers.dev/health",
    },
  ];
  let activeProxy = null;

  const LS = {
    model: "ws_ds_model",
    hist: (id) => "ws_hist_" + id,
  };
  const MAX_HIST = 24; // 每个助手最多保留的消息条数（不含系统提示）

  // ---------- 四个助手预设 ----------
  const ASSISTANTS = {
    topics: {
      icon: "💡",
      name: "爆款选题策划师",
      desc: "说清楚你的赛道、人群和产品，AI 给你一批能打的选题。",
      temperature: 1.2,
      chips: [
        "我的赛道：母婴辅食，目标人群：新手宝妈，帮我想 10 个选题",
        "我的赛道：职场副业，人群：25-35 岁上班族，给我 10 个选题",
        "我开了家烘焙店，想用小红书给门店引流，出 10 个选题",
      ],
      system:
        "你是小红书爆款选题策划师，精通「定位 → 选题 → 内容 → 变现」的自媒体方法论。" +
        "用户会告诉你赛道、人群或产品，你要输出 10 个具体可执行的选题。" +
        "每个选题包含：①选题标题 ②切入角度（一句话）③戳中的痛点或爽点。" +
        "选题要具体、有网感、能引发共鸣，避免空泛（如「分享xxx的day1」这种没信息量的不要）。" +
        "10 个选题尽量覆盖不同角度：痛点型、反差型、盘点型、教程型、故事型、蹭热点型。" +
        "用编号列表输出，语言接地气，像资深运营在带新人。",
    },
    rewrite: {
      icon: "✍️",
      name: "爆款改写专家",
      desc: "把你的笔记或口播稿粘贴进来，按爆款结构重写一遍。",
      temperature: 1.1,
      chips: [
        "把下面这段笔记改成爆款：今天给大家分享一下我做小红书三个月的心得，一开始很难……",
        "这是我的一条口播稿，帮我改成更有钩子的版本：（粘贴原文）",
        "帮我改写这条视频文案，开头前三秒必须有钩子：（粘贴原文）",
      ],
      system:
        "你是爆款内容改写专家，深谙小红书与短视频的爆款结构。" +
        "用户会给你一段原始笔记或口播稿，你要在不改变核心信息的前提下重写成爆款版本，要求：" +
        "①开头 3 秒钩子（扎心提问 / 反常识 / 结果前置，任选其一）②正文口语化、短句为主、有具体细节和数字 " +
        "③结尾加互动引导（提问或留言钩子）。" +
        "输出两部分：【改写版本】和【改动说明】（列出 3-5 个关键改动点及原因）。语言有网感，不要 AI 腔。",
    },
    titles: {
      icon: "🎯",
      name: "爆款标题写手",
      desc: "给 AI 一个主题，它按不同爆款公式给你一批标题。",
      temperature: 1.3,
      chips: [
        "主题：普通人做自媒体副业变现，给我 10 个标题",
        "主题：全职妈妈两年涨粉 10 万的经历分享，给我 10 个标题",
        "主题：实体店主做小红书引流的方法，给我 10 个标题",
      ],
      system:
        "你是小红书爆款标题专家。用户给你一个主题，你输出 10 个标题，并给每个标题标注所用公式。" +
        "覆盖这些公式：数字盘点、悬念好奇、痛点扎心、身份共鸣、对比反差、干货合集、结果前置、误区警示。" +
        "标题要口语化、有具体数字或身份词、控制在 20 字以内，禁止标题党到失真。" +
        "输出格式：编号 + 标题 +（公式名）。",
    },
    cover: {
      icon: "🖼️",
      name: "爆款封面策划",
      desc: "输出封面文案 + 构图方案 + AI 绘图提示词（出图需配合绘图工具）。",
      temperature: 1.2,
      chips: [
        "主题：普通人靠自媒体接到第一单商单，给我封面方案",
        "主题：小白也能学会的 AI 选题方法，给我封面方案",
        "主题：门店引流实战复盘，给我封面方案",
      ],
      system:
        "你是小红书封面策划师。注意：你是文字模型，不能直接生成图片，所以你的任务是为封面输出完整方案，包括：" +
        "①主文案（不超过 10 个字，大字压屏用）②副文案（一行小字）③排版构图建议（大字位置、人物/实拍/纯文字型、上下留白）" +
        "④配色建议（给 2-3 组具体的色值搭配）⑤一段给 AI 绘图工具（如即梦、Midjourney）使用的画面提示词（中文描述 + 对应英文 prompt）。" +
        "给用户 2 套不同风格的方案，标注「方案一 / 方案二」。文字方案要符合小红书封面的高对比、大字号习惯。",
    },
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const modelSelect = $("dsModelSelect");
  const serviceStatus = $("wsServiceStatus");
  const tabsEl = $("wsTabs");
  const panelIcon = $("wsPanelIcon");
  const panelName = $("wsPanelName");
  const panelDesc = $("wsPanelDesc");
  const chatEl = $("wsChat");
  const chipsEl = $("wsChips");
  const inputEl = $("wsInput");
  const sendBtn = $("wsSendBtn");
  const stopBtn = $("wsStopBtn");
  const clearBtn = $("wsClearBtn");
  const copyBtn = $("wsCopyBtn");

  let current = "topics";
  let controller = null; // AbortController，用于停止生成
  let generating = false;

  // ---------- 工具函数 ----------
  function getModel() {
    return localStorage.getItem(LS.model) || "deepseek-chat";
  }
  function getHist(id) {
    try {
      const v = JSON.parse(localStorage.getItem(LS.hist(id)) || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  function saveHist(id, hist) {
    localStorage.setItem(LS.hist(id), JSON.stringify(hist.slice(-MAX_HIST)));
  }
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // 极简 Markdown 渲染（标题 / 加粗 / 行内代码 / 列表 / 换行）
  function renderMd(text) {
    const lines = escapeHtml(text).split("\n");
    let html = "";
    let inList = false;
    for (const raw of lines) {
      const line = raw.trimEnd();
      const li = line.match(/^\s*(?:[-*]|\d+[.、)])\s+(.*)$/);
      if (li) {
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        html += "<li>" + inline(li[1]) + "</li>";
        continue;
      }
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      const h = line.match(/^(#{2,4})\s+(.*)$/);
      if (h) {
        html += "<h4>" + inline(h[2]) + "</h4>";
      } else if (line === "") {
        html += "";
      } else {
        html += "<p>" + inline(line) + "</p>";
      }
    }
    if (inList) html += "</ul>";
    return html;

    function inline(s) {
      return s
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
    }
  }

  // ---------- 渲染 ----------
  function bubble(role, content, isStreaming) {
    const wrap = document.createElement("div");
    wrap.className = "ws-msg ws-" + role;
    const avatar = document.createElement("span");
    avatar.className = "ws-avatar";
    avatar.textContent = role === "user" ? "我" : "AI";
    const body = document.createElement("div");
    body.className = "ws-bubble";
    if (role === "assistant") {
      body.innerHTML = content ? renderMd(content) : '<span class="ws-typing">正在思考…</span>';
    } else {
      body.textContent = content;
    }
    if (isStreaming) body.classList.add("ws-streaming");
    wrap.appendChild(avatar);
    wrap.appendChild(body);
    chatEl.appendChild(wrap);
    chatEl.scrollTop = chatEl.scrollHeight;
    return { wrap, body };
  }

  function renderEmptyHint() {
    const a = ASSISTANTS[current];
    chatEl.innerHTML = "";
    const hint = document.createElement("div");
    hint.className = "ws-empty";
    hint.innerHTML =
      '<span class="ws-empty-icon">' + a.icon + "</span>" +
      "<p>我是你的" + a.name + "。</p>" +
      "<p>下面有几个现成的例子，点一下就能开始；也可以直接在输入框里描述你的需求。</p>";
    chatEl.appendChild(hint);
  }

  function renderChat() {
    const hist = getHist(current);
    chatEl.innerHTML = "";
    if (!hist.length) {
      renderEmptyHint();
      return;
    }
    for (const m of hist) bubble(m.role, m.content, false);
  }

  function renderPanel() {
    const a = ASSISTANTS[current];
    panelIcon.textContent = a.icon;
    panelName.textContent = a.name;
    panelDesc.textContent = a.desc;
    chipsEl.innerHTML = "";
    a.chips.forEach((text) => {
      const chip = document.createElement("button");
      chip.className = "ws-chip";
      chip.type = "button";
      chip.textContent = text.length > 34 ? text.slice(0, 34) + "…" : text;
      chip.title = text;
      chip.addEventListener("click", () => {
        inputEl.value = text;
        inputEl.focus();
      });
      chipsEl.appendChild(chip);
    });
    renderChat();
  }

  function renderServiceStatus(ok, text) {
    serviceStatus.innerHTML = ok
      ? 'AI 服务：<b class="ws-status-on">' + text + "</b>"
      : 'AI 服务：<b class="ws-status-off">' + text + "</b>";
  }

  // ---------- 代理通道 ----------
  async function pickProxy() {
    if (activeProxy) return activeProxy;
    // 云函数有冷启动，多试一轮、放宽超时
    for (let attempt = 0; attempt < 2 && !activeProxy; attempt++) {
      for (const p of PROXIES) {
        try {
          const r = await Promise.race([
            fetch(p.health),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
          ]);
          if (r && r.ok) {
            activeProxy = p;
            renderServiceStatus(true, "在线 ✓ · " + p.name);
            return p;
          }
        } catch (e) {
          /* 尝试下一个通道 */
        }
      }
    }
    renderServiceStatus(false, "暂未连通（仍可尝试发送）");
    return null;
  }

  // ---------- 设置 ----------
  modelSelect.value = getModel();

  modelSelect.addEventListener("change", () => {
    localStorage.setItem(LS.model, modelSelect.value);
  });

  // 启动时探测可用通道（失败稍后自动重试，兼顾云函数冷启动）
  renderServiceStatus(false, "检测中…");
  pickProxy().then((p) => {
    if (!p) setTimeout(() => pickProxy(), 4000);
  });

  // ---------- 切换助手 ----------
  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".ws-tab");
    if (!btn || generating) return;
    current = btn.dataset.ws;
    tabsEl.querySelectorAll(".ws-tab").forEach((t) => {
      const on = t === btn;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    renderPanel();
  });

  // ---------- 清空 / 复制 ----------
  clearBtn.addEventListener("click", () => {
    if (generating) return;
    localStorage.removeItem(LS.hist(current));
    renderChat();
  });

  copyBtn.addEventListener("click", () => {
    const hist = getHist(current);
    const lastAi = [...hist].reverse().find((m) => m.role === "assistant");
    if (!lastAi) return;
    navigator.clipboard
      .writeText(lastAi.content)
      .then(() => {
        copyBtn.textContent = "✓ 已复制";
        setTimeout(() => (copyBtn.textContent = "📋 复制回答"), 1500);
      })
      .catch(() => {});
  });

  // ---------- 发送 ----------
  function setGenerating(on) {
    generating = on;
    sendBtn.classList.toggle("hidden", on);
    stopBtn.classList.toggle("hidden", !on);
    inputEl.disabled = on;
  }

  function friendlyError(status) {
    if (status === 403) return "当前页面不在允许的访问来源内。请通过官网地址访问工作坊。";
    if (status === 402) return "工作坊额度暂时用完，正在充值维护，请稍后再来或联系谈谈。";
    if (status === 429) return "请求太频繁了，休息几秒再试。";
    if (status >= 500) return "AI 服务器开小差了，稍等一下再重试。";
    return "请求失败（HTTP " + status + "），请稍后重试。";
  }

  async function send() {
    if (generating) return;
    const text = inputEl.value.trim();
    if (!text) return;

    const hist = getHist(current);
    hist.push({ role: "user", content: text });
    if (hist.length === 1) chatEl.innerHTML = ""; // 清掉欢迎语
    inputEl.value = "";
    setGenerating(true);

    // 渲染用户消息 + 空的 AI 气泡
    bubble("user", text, false);
    const ai = bubble("assistant", "", true);
    let full = "";

    // 不依赖健康探测，直接逐条通道发真实请求；网络不通或限流时换下一个通道
    const order = [];
    if (activeProxy) order.push(activeProxy);
    for (const p of PROXIES) if (!order.includes(p)) order.push(p);

    controller = new AbortController();
    const messages = [
      { role: "system", content: ASSISTANTS[current].system },
      ...hist.slice(-12), // 只带最近 12 条，控制 token 消耗
    ];

    async function callProxy(p) {
      return fetch(p.chat, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: getModel(),
          messages,
          stream: true,
          temperature: ASSISTANTS[current].temperature,
        }),
        signal: controller.signal,
      });
    }

    let res = null;
    let lastStatus = 0;
    for (const p of order) {
      activeProxy = p;
      let r;
      try {
        r = await callProxy(p);
      } catch (netErr) {
        if (netErr && netErr.name === "AbortError") throw netErr;
        continue; // 这条线路不通（超时/被墙/断网），换下一个
      }
      if (r.ok) {
        res = r;
        break;
      }
      lastStatus = r.status;
      if (r.status === 429 || r.status >= 500) continue; // 限流或服务故障，换下一个通道
      res = r; // 其他状态（403/402 等）按此响应给出提示
      break;
    }

    if (!res) {
      ai.body.classList.remove("ws-streaming");
      ai.body.innerHTML =
        '<span class="ws-error">' +
        (lastStatus
          ? friendlyError(lastStatus) + "（两条线路都已尝试）"
          : "第一次唤起 AI 服务可能较慢，请稍等几秒再发一次；如果多次失败请联系谈谈。") +
        "</span>";
      setGenerating(false);
      controller = null;
      return;
    }

    if (!res.ok) {
      ai.body.classList.remove("ws-streaming");
      ai.body.innerHTML = '<span class="ws-error">' + friendlyError(res.status) + "</span>";
      setGenerating(false);
      controller = null;
      return;
    }

    try {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.indexOf("text/event-stream") !== -1) {
        // 流式（Cloudflare 通道）：逐段渲染
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload);
              const delta =
                json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
              if (delta) {
                full += delta;
                ai.body.innerHTML = renderMd(full);
                chatEl.scrollTop = chatEl.scrollHeight;
              }
            } catch (e) {
              /* 忽略不完整分段 */
            }
          }
        }
      } else {
        // 非流式 JSON（腾讯云函数通道）：一次性渲染
        const data = await res.json();
        if (data.error) {
          ai.body.classList.remove("ws-streaming");
          ai.body.innerHTML = '<span class="ws-error">' + (data.error || "服务异常") + "</span>";
          setGenerating(false);
          controller = null;
          return;
        }
        full =
          (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
        ai.body.innerHTML = renderMd(full);
        chatEl.scrollTop = chatEl.scrollHeight;
      }

      if (!full) full = "（AI 没有返回内容，请重试）";
      ai.body.classList.remove("ws-streaming");
      ai.body.innerHTML = renderMd(full);
      hist.push({ role: "assistant", content: full });
      saveHist(current, hist);
    } catch (err) {
      ai.body.classList.remove("ws-streaming");
      if (err && err.name === "AbortError") {
        if (full) {
          ai.body.innerHTML = renderMd(full + "\n\n（已停止生成）");
          hist.push({ role: "assistant", content: full });
          saveHist(current, hist);
        } else {
          ai.body.innerHTML = '<span class="ws-error">已停止生成。</span>';
        }
      } else {
        ai.body.innerHTML =
          '<span class="ws-error">网络异常，暂时连不上 AI 服务。请检查网络后重试。</span>';
      }
    } finally {
      setGenerating(false);
      controller = null;
    }
  }

  sendBtn.addEventListener("click", send);
  stopBtn.addEventListener("click", () => {
    if (controller) controller.abort();
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  // ---------- 初始化 ----------
  renderPanel();
})();
