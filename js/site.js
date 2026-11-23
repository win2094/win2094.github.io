(() => {
  const root = document.documentElement;
  const stored = localStorage.getItem("hsu-lang");
  const initial = stored === "zh" || stored === "en"
    ? stored
    : (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  root.dataset.lang = initial;

  document.querySelectorAll("[data-lang-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = root.dataset.lang === "zh" ? "en" : "zh";
      root.dataset.lang = next;
      localStorage.setItem("hsu-lang", next);
      btn.setAttribute("aria-label", next === "zh" ? "Switch to English" : "切換至中文");
      btn.textContent = next === "zh" ? "EN" : "中文";
    });
    btn.textContent = initial === "zh" ? "EN" : "中文";
    btn.setAttribute("aria-label", initial === "zh" ? "Switch to English" : "切換至中文");
  });

  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.16 })
    : null;

  document.querySelectorAll(".reveal").forEach((el) => {
    if (io) io.observe(el);
    else el.classList.add("is-in");
  });

  // Ensure first game band visible even if IO is delayed
  requestAnimationFrame(() => {
    document.querySelectorAll(".reveal").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92) el.classList.add("is-in");
    });
  });

  const flyEmbed = document.querySelector(".fly-embed");
  const flyFrame = document.getElementById("fly-frame");
  const flyFocus = document.querySelector("[data-fly-focus]");
  if (flyEmbed && flyFrame && flyFocus) {
    const focusFly = () => {
      flyEmbed.classList.add("is-focused");
      try { flyFrame.focus(); } catch (_) { /* ignore */ }
    };
    flyFocus.addEventListener("click", focusFly);
    flyFrame.addEventListener("focus", () => flyEmbed.classList.add("is-focused"));
    flyFrame.addEventListener("blur", () => {
      // keep overlay hidden once played; avoid flicker when clicking inside game
    });
  }
})();
