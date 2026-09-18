/* ============================================================
   谈谈在成长 — 页面交互
   ============================================================ */

// ---------- 导航栏：滚动后加毛玻璃背景 ----------
const navbar = document.getElementById("navbar");
function updateNav() {
  navbar.classList.toggle("scrolled", window.scrollY > 24);
}
window.addEventListener("scroll", updateNav, { passive: true });
updateNav();

// ---------- 移动端菜单 ----------
const navToggle = document.getElementById("navToggle");
const navLinks = document.getElementById("navLinks");
navToggle.addEventListener("click", () => {
  navToggle.classList.toggle("open");
  navLinks.classList.toggle("open");
});
navLinks.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    navToggle.classList.remove("open");
    navLinks.classList.remove("open");
  })
);

// ---------- 滚动入场动画 ----------
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
);
document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

// ---------- 数字滚动动画 ----------
const statsObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      statsObserver.unobserve(el);
      const target = parseInt(el.dataset.count, 10);
      const prefix = el.dataset.prefix || "";
      const suffix = el.dataset.suffix || "";
      const duration = 1400;
      const start = performance.now();
      function tick(now) {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        el.textContent = prefix + Math.round(target * eased).toLocaleString() + suffix;
        if (t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  },
  { threshold: 0.5 }
);
document.querySelectorAll(".stat-num[data-count]").forEach((el) => statsObserver.observe(el));

// ---------- 学员案例筛选 ----------
const filterTabs = document.querySelectorAll(".filter-tab");
const caseCards = document.querySelectorAll(".case-card");
filterTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const filter = tab.dataset.filter;
    filterTabs.forEach((t) => t.classList.toggle("active", t === tab));
    caseCards.forEach((card) => {
      const show = filter === "all" || card.dataset.product === filter;
      card.classList.toggle("hidden", !show);
      // 重新触发入场动画
      if (show) {
        card.classList.remove("visible");
        requestAnimationFrame(() =>
          requestAnimationFrame(() => card.classList.add("visible"))
        );
      }
    });
  });
});

// ---------- 跑马灯：复制一份内容实现无缝循环 ----------
document.querySelectorAll(".marquee-track").forEach((track) => {
  track.innerHTML += track.innerHTML;
});

// ---------- 联系弹窗（仅在存在弹窗的页面生效） ----------
const modal = document.getElementById("contactModal");
if (modal) {
  function openModal() {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }
  function closeModal() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }
  document.querySelectorAll(".js-contact").forEach((el) =>
    el.addEventListener("click", openModal)
  );
  modal.querySelectorAll(".js-modal-close").forEach((el) =>
    el.addEventListener("click", closeModal)
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("open")) closeModal();
  });
}

// ---------- 二维码：qr.png 存在则显示，否则显示占位提示 ----------
document.querySelectorAll(".qr-box").forEach((box) => {
  const img = box.querySelector("img");
  if (!img) return;
  if (img.complete && img.naturalWidth > 0) {
    box.classList.add("has-qr");
  }
  img.addEventListener("load", () => box.classList.add("has-qr"));
  img.addEventListener("error", () => {
    img.classList.add("missing");
    box.classList.remove("has-qr");
  });
});

// ---------- 详情页：FAQ 折叠 ----------
document.querySelectorAll(".faq-item").forEach((item) => {
  const q = item.querySelector(".faq-q");
  if (!q) return;
  q.addEventListener("click", () => item.classList.toggle("open"));
});

// ---------- 活动掠影：照片缺失时显示占位背景 ----------
document.querySelectorAll(".photo img").forEach((img) => {
  img.addEventListener("error", () => { img.style.display = "none"; });
});
