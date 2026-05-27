// Pure helper for tab / pill switching. Kept in its own module (no DOM
// side effects at import time) so tests can `import { initTabs }` here
// directly instead of maintaining a parallel copy — the parallel copy
// drifted once already and missed the "pill bar doesn't switch tools"
// bug because the test's local helper had the right selector but the
// production code in main.js didn't.

export function initTabs(root, barSelector, contentPrefix) {
  const bar = root.querySelector(barSelector);
  if (!bar) return;
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn, .pill-btn");
    if (!btn || btn.disabled) return;
    bar.querySelectorAll(".tab-btn, .pill-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const key = btn.dataset.tab || btn.dataset.tool;
    const parent = bar.parentElement;
    parent.querySelectorAll(`:scope > [id^="${contentPrefix}"]`).forEach((el) => {
      el.classList.toggle("active", el.id === `${contentPrefix}${key}`);
    });
  });
}
