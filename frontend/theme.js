// Loaded in <head> before the page draws, so dark mode never flashes light first.
// The choice lives in localStorage ("light" or "dark"); without one, follow the system setting.
(function () {
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch { /* storage blocked */ }
  const dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", dark);
})();
