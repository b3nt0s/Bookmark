// Loaded in <head> before the page draws, so dark mode never flashes light first.
// The site starts in light mode; dark mode is used only after the user turns it on
// (saved in localStorage as "dark"). The key is "colorTheme", not the earlier "theme",
// so choices saved back when the site followed the system setting are ignored.
(function () {
  let saved = null;
  try { saved = localStorage.getItem("colorTheme"); } catch { /* storage blocked */ }
  document.documentElement.classList.toggle("dark", saved === "dark");
})();
