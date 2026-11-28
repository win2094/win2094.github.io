(() => {
  const root = document.documentElement;
  const stored = localStorage.getItem("hsu-lang");
  const initial = stored === "zh" || stored === "en"
    ? stored
    : (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  root.dataset.lang = initial;

  document.querySelectorAll("[data-lang-toggle]").forEach((btn) => {
    const sync = (lang) => {
      btn.textContent = lang === "zh" ? "EN" : "中文";
      btn.setAttribute("aria-label", lang === "zh" ? "Switch to English" : "切換至中文");
    };
    sync(initial);
    btn.addEventListener("click", () => {
      const next = root.dataset.lang === "zh" ? "en" : "zh";
      root.dataset.lang = next;
      localStorage.setItem("hsu-lang", next);
      sync(next);
    });
  });

  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach((el) => {
      // Above-the-fold: show immediately without waiting for IO
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
        el.classList.add("is-in");
      } else {
        io.observe(el);
      }
    });
  } else {
    reveals.forEach((el) => el.classList.add("is-in"));
  }

  const flyEmbed = document.querySelector(".fly-embed");
  const flyFrame = document.getElementById("fly-frame");
  const flyFocus = document.querySelector("[data-fly-focus]");
  if (flyEmbed && flyFrame && flyFocus) {
    const focus = () => {
      flyEmbed.classList.add("is-focused");
      flyFrame.focus();
    };
    flyFocus.addEventListener("click", focus);
    flyFrame.addEventListener("focus", () => flyEmbed.classList.add("is-focused"));
  }
})();
