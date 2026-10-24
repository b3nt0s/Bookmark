// Testing-phase glue for the Stitch screens: Google sign-in, page links, the uploaded flyer,
// and the event the user confirms. The flyer is sent to the backend for OCR; no Calendar calls
// yet. Flyer and event state lives in sessionStorage so it resets when the tab closes.

// Backend base URL. Empty means same origin: the backend serves this site, and `npm run dev`
// proxies /api to it. Set it (e.g. "https://api.example.com") if the front end is hosted apart.
const API_BASE = "";

const PAGES = {
  signIn: "/",
  howItWorks: "/screens/how-it-works.html",
  upload: "/screens/02-upload-or-snap-flyer-bookmark.html",
  review: "/screens/03-review-confirm-event-bookmark.html",
  synced: "/screens/04-event-synced-google-calendar.html",
  recent: "/screens/recent-events.html",
};

// Where each footer or in-page link (data-path) goes.
const NAV = {
  "upload-flyer": PAGES.upload,
  "recent-events": PAGES.recent,
  "how-it-works": PAGES.howItWorks,
};

// Header tabs. The synced page is only reached by finishing a sync, so it has no tab.
const TABS = [
  { key: "how", label: "How it Works", href: PAGES.howItWorks, icon: "lightbulb" },
  { key: "upload", label: "Upload Flyer", href: PAGES.upload, icon: "upload_file" },
  { key: "recent", label: "Recent Events", href: PAGES.recent, icon: "history" },
];

// Which tab is highlighted on each page (body data-page).
const ACTIVE_TAB = { "how-it-works": "how", upload: "upload", review: "upload", synced: "upload", recent: "recent" };

const store = {
  get(key) {
    try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  clear() {
    sessionStorage.removeItem("flyer");
    sessionStorage.removeItem("event");
  },
};

// Events the user has added, newest first. Kept in this browser (localStorage) per account,
// so they survive closing the tab; there is no server-side history yet.
const MAX_RECENT = 50;

const recent = {
  key() {
    return `recentEvents:${currentUser?.email ?? "guest"}`;
  },
  list() {
    try { return JSON.parse(localStorage.getItem(this.key())) ?? []; } catch { return []; }
  },
  save(items) {
    try { localStorage.setItem(this.key(), JSON.stringify(items.slice(0, MAX_RECENT))); } catch { /* storage full or blocked */ }
  },
  // Re-confirming the same event (back from the synced page, then Add again) updates it in place.
  upsert(ev) {
    this.save([ev, ...this.list().filter((e) => e.id !== ev.id)]);
  },
  remove(id) {
    this.save(this.list().filter((e) => e.id !== id));
  },
};

function go(url) {
  window.location.href = url;
}

// Finds the innermost clickable element whose text includes `text`.
function byText(text, selector = "button, a") {
  return [...document.querySelectorAll(selector)].find((el) => el.textContent.includes(text));
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- Header: tabs, mobile menu, profile menu ----------

function tabLink(tab, active, { stacked = false } = {}) {
  const base = stacked
    ? "flex items-center gap-3 px-4 py-3 rounded-lg font-label-lg text-label-lg transition-colors"
    : "px-space-md py-space-sm rounded-lg font-label-lg text-label-lg transition-all";
  const state = active
    ? "bg-surface-container-highest text-primary"
    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface";
  const icon = stacked ? `<span class="material-symbols-outlined text-[20px]">${tab.icon}</span>` : "";
  return `<a href="${tab.href}" class="${base} ${state}"${active ? ' aria-current="page"' : ""}>${icon}${tab.label}</a>`;
}

function renderHeader() {
  const header = document.querySelector("header");
  if (!header) return;
  const active = ACTIVE_TAB[document.body.dataset.page];

  header.innerHTML = `
    <div class="h-16 w-full px-margin flex items-center justify-between">
      <div class="flex items-center gap-space-sm lg:gap-space-lg">
        <button id="nav-open" type="button" class="lg:hidden -ml-2 w-10 h-10 inline-flex items-center justify-center rounded-lg text-on-surface hover:bg-surface-container-high" aria-label="Open menu" aria-controls="nav-drawer" aria-expanded="false">
          <span class="material-symbols-outlined">menu</span>
        </button>
        <a class="flex items-center gap-space-sm" href="${PAGES.upload}">
          <span class="font-headline-sm text-headline-sm text-primary tracking-tight">Bookmark</span>
          <img alt="" class="h-8 w-8 object-contain" src="/logo.png">
        </a>
        <nav class="hidden lg:flex items-center gap-space-xs" aria-label="Main">
          ${TABS.map((t) => tabLink(t, t.key === active)).join("")}
        </nav>
      </div>
      <div class="relative">
        <button id="profile-btn" type="button" class="flex items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Account menu" aria-haspopup="menu" aria-controls="profile-menu" aria-expanded="false">
          <img id="profile-img" alt="" class="hidden w-8 h-8 rounded-full object-cover" referrerpolicy="no-referrer">
          <span id="profile-fallback" class="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-label-lg text-label-lg">
            <span class="material-symbols-outlined text-[20px]">person</span>
          </span>
        </button>
        <div id="profile-menu" role="menu" class="hidden absolute right-0 mt-2 w-64 rounded-xl bg-surface-container-lowest border border-outline-variant/60 shadow-xl p-2">
          <div class="px-3 py-2">
            <p id="profile-name" class="font-title-md text-title-md text-on-surface truncate">Signed in</p>
            <p id="profile-email" class="font-body-sm text-body-sm text-on-surface-variant truncate"></p>
          </div>
          <div class="my-1 border-t border-outline-variant/60"></div>
          <button id="theme-toggle" type="button" role="menuitemcheckbox" aria-checked="false" class="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-on-surface hover:bg-surface-container-high font-label-lg text-label-lg">
            <span class="flex items-center gap-3"><span class="material-symbols-outlined text-[20px]">dark_mode</span>Dark mode</span>
            <span data-track class="relative w-9 h-5 rounded-full bg-outline-variant transition-colors">
              <span data-knob class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-surface-container-lowest shadow transition-transform"></span>
            </span>
          </button>
          <button id="sign-out" type="button" role="menuitem" class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-error hover:bg-surface-container-high font-label-lg text-label-lg">
            <span class="material-symbols-outlined text-[20px]">logout</span>Sign out
          </button>
        </div>
      </div>
    </div>`;

  // The drawer lives on <body>: the header's backdrop blur would trap a fixed child inside it.
  const drawer = document.createElement("div");
  drawer.id = "nav-drawer";
  drawer.className = "fixed inset-0 z-[60] lg:hidden invisible";
  drawer.innerHTML = `
    <div data-close class="absolute inset-0 bg-black/40 opacity-0 transition-opacity duration-200"></div>
    <aside role="dialog" aria-modal="true" aria-label="Menu" class="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-surface-container-low shadow-2xl -translate-x-full transition-transform duration-200 flex flex-col">
      <div class="h-16 px-4 flex items-center justify-between border-b border-outline-variant/60">
        <span class="flex items-center gap-space-sm">
          <img alt="" class="h-7 w-7 object-contain" src="/logo.png">
          <span class="font-headline-sm text-headline-sm text-primary tracking-tight">Bookmark</span>
        </span>
        <button data-close type="button" class="w-10 h-10 inline-flex items-center justify-center rounded-lg text-on-surface hover:bg-surface-container-high" aria-label="Close menu">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <nav class="p-3 flex flex-col gap-1" aria-label="Main">
        ${TABS.map((t) => tabLink(t, t.key === active, { stacked: true })).join("")}
      </nav>
    </aside>`;
  document.body.append(drawer);

  wireDrawer(drawer);
  wireProfileMenu();
}

function wireDrawer(drawer) {
  const openBtn = document.getElementById("nav-open");
  const scrim = drawer.querySelector("[data-close]");
  const panel = drawer.querySelector("aside");

  const setOpen = (open) => {
    drawer.classList.toggle("invisible", !open);
    scrim.classList.toggle("opacity-0", !open);
    panel.classList.toggle("-translate-x-full", !open);
    openBtn.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
    if (open) panel.querySelector("a")?.focus();
    else if (drawer.contains(document.activeElement)) openBtn.focus();
  };

  openBtn.addEventListener("click", () => setOpen(true));
  drawer.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", () => setOpen(false)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawer.classList.contains("invisible")) setOpen(false);
  });
  // Widening past the tab breakpoint shows the tabs again, so close the drawer.
  window.matchMedia("(min-width: 1024px)").addEventListener("change", (e) => e.matches && setOpen(false));
}

function setTheme(dark) {
  document.documentElement.classList.toggle("dark", dark);
  try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* storage blocked */ }
  showThemeSwitch();
}

function showThemeSwitch() {
  const toggle = document.getElementById("theme-toggle");
  if (!toggle) return;
  const dark = document.documentElement.classList.contains("dark");
  toggle.setAttribute("aria-checked", String(dark));
  toggle.querySelector("[data-track]").classList.toggle("bg-primary", dark);
  toggle.querySelector("[data-track]").classList.toggle("bg-outline-variant", !dark);
  toggle.querySelector("[data-knob]").classList.toggle("translate-x-4", dark);
}

function wireProfileMenu() {
  const btn = document.getElementById("profile-btn");
  const menu = document.getElementById("profile-menu");

  const setOpen = (open) => {
    menu.classList.toggle("hidden", !open);
    btn.setAttribute("aria-expanded", String(open));
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(menu.classList.contains("hidden"));
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.classList.contains("hidden")) {
      setOpen(false);
      btn.focus();
    }
  });

  document.getElementById("theme-toggle").addEventListener("click", () => {
    setTheme(!document.documentElement.classList.contains("dark"));
  });
  showThemeSwitch();

  document.getElementById("sign-out").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    store.clear();
    go(PAGES.signIn);
  });
}

// ---------- Account ----------

// The Stitch screens show a placeholder account; this is it.
const PLACEHOLDER_EMAIL = "alex.doe@gmail.com";

let currentUser = null;

function showAccount(user) {
  currentUser = user;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue.includes(PLACEHOLDER_EMAIL)) {
      node.nodeValue = node.nodeValue.replaceAll(PLACEHOLDER_EMAIL, user.email);
    }
  }

  document.getElementById("profile-name").textContent = user.name;
  document.getElementById("profile-email").textContent = user.email;
  document.getElementById("profile-btn").title = `${user.name} (${user.email})`;
  if (user.picture) {
    const img = document.getElementById("profile-img");
    img.src = user.picture;
    img.classList.remove("hidden");
    document.getElementById("profile-fallback").classList.add("hidden");
  }
}

// Every page after sign-in needs a Google account; without one, back to the start.
async function requireAccount() {
  try {
    const res = await fetch("/api/auth/me");
    if (res.status === 401) return go(PAGES.signIn);
    if (res.ok) showAccount((await res.json()).user);
  } catch {
    // Backend unreachable: leave the placeholder account so the screens still work.
  }
}

function wireNav() {
  document.querySelectorAll("a[data-path]").forEach((a) => {
    const target = NAV[a.dataset.path];
    if (target) a.href = target;
  });
}

// ---------- Upload ----------

const MAX_PREVIEW_SIDE = 1600;

// Shrinks the photo so it fits in sessionStorage. Formats the browser can't draw
// (HEIC in most browsers, PDF) keep their name and size but get no preview.
function readFlyer(file) {
  const info = { name: file.name, size: file.size, preview: null, width: null, height: null };
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_PREVIEW_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve({ ...info, preview: canvas.toDataURL("image/jpeg", 0.85), width: img.width, height: img.height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(info);
    };
    img.src = url;
  });
}

// Sends the photo to the backend. Resolves to { text } or { error: "message to show" }.
async function extractFlyerText(file) {
  const body = new FormData();
  body.append("file", file);
  body.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
  body.append("reference_datetime", new Date().toISOString());
  try {
    const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error?.message || `Upload failed (${res.status}).` };
    return { text: data.text };
  } catch {
    return { error: "Couldn't reach the server. Check your connection and try again." };
  }
}

function showScanStatus(title, detail, { failed = false } = {}) {
  const banner = document.getElementById("processing-banner");
  if (!banner) return;
  banner.classList.remove("hidden");
  banner.scrollIntoView({ behavior: "smooth", block: "center" }); // it sits below the fold on phones
  const [titleEl, detailEl] = banner.querySelectorAll("span.font-title-md, span.font-body-sm");
  titleEl.textContent = title;
  detailEl.textContent = detail;
  banner.querySelector(".animate-spin, .rounded-full")?.classList.toggle("animate-spin", !failed);
}

async function acceptFlyer(file) {
  if (!file) return;
  showScanStatus("Reading your flyer...", "Extracting the text. This can take a few seconds.");
  const [flyer, ocr] = await Promise.all([readFlyer(file), extractFlyerText(file)]);
  if (ocr.error) {
    showScanStatus("Couldn't read that flyer", ocr.error, { failed: true });
    document.getElementById("flyer-file-input").value = ""; // let the same file be picked again
    return;
  }
  store.clear();
  const saved = { ...flyer, text: ocr.text };
  if (!store.set("flyer", saved)) store.set("flyer", { ...saved, preview: null });
  go(PAGES.review);
}

function setUpUploadPage() {
  const fileInput = document.getElementById("flyer-file-input");
  const cameraInput = document.getElementById("flyer-camera-input");

  window.handleFileSelect = (evt) => acceptFlyer(evt.target.files?.[0]);
  window.openCamera = () => cameraInput.click();

  const scanLink = byText("Scan with phone camera", "a");
  scanLink?.addEventListener("click", (e) => {
    e.preventDefault();
    cameraInput.click();
  });

  const dropzone = byText("Drag and drop flyer here", "div[onclick]");
  if (dropzone) {
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("ring-2", "ring-primary");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("ring-2", "ring-primary"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("ring-2", "ring-primary");
      acceptFlyer(e.dataTransfer.files?.[0]);
    });
  }

  // Coming back from Replace flyer: let the same file be picked again.
  fileInput.value = "";
}

// ---------- Review ----------

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function dataUrlToBlobUrl(dataUrl) {
  const [head, body] = dataUrl.split(",");
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: head.match(/:(.*?);/)[1] }));
}

function reviewFields() {
  const [startDate, endDate] = document.querySelectorAll('#event-editor-form input[type="date"]');
  const [startTime, endTime] = document.querySelectorAll('#event-editor-form input[type="time"]');
  return {
    title: document.getElementById("event-title-input"),
    allDay: document.getElementById("all-day-toggle"),
    startDate, startTime, endDate, endTime,
    location: document.getElementById("event-location-input"),
    description: document.getElementById("event-desc-textarea"),
    reminder: document.getElementById("event-reminder-select"),
  };
}

function setUpReviewPage() {
  const flyer = store.get("flyer");
  const fields = reviewFields();

  if (flyer) {
    const nameEl = byText("spring-summit-2025.jpg", "p");
    if (nameEl) {
      nameEl.textContent = flyer.name;
      nameEl.nextElementSibling.textContent = flyer.width
        ? `${formatSize(flyer.size)} • ${flyer.width} × ${flyer.height}px`
        : `${formatSize(flyer.size)} • preview not available for this file type`;
    }
    if (flyer.preview) {
      document.getElementById("scanned-image").src = flyer.preview;
      const original = byText("View original", "a");
      if (original) original.href = dataUrlToBlobUrl(flyer.preview);
    }
  }

  // No date or title parsing yet: show the flyer's extracted text in the description.
  if (flyer?.text) fields.description.value = flyer.text;

  // Returning from the synced page with "Edit": restore what was entered.
  const saved = store.get("event");
  if (saved) {
    for (const key of ["title", "startDate", "startTime", "endDate", "endTime", "location", "description", "reminder"]) {
      if (fields[key] && saved[key] != null) fields[key].value = saved[key];
    }
    fields.allDay.checked = saved.allDay;
  }

  const toggleTimes = () => {
    fields.startTime.disabled = fields.endTime.disabled = fields.allDay.checked;
    fields.startTime.classList.toggle("opacity-40", fields.allDay.checked);
    fields.endTime.classList.toggle("opacity-40", fields.allDay.checked);
  };
  fields.allDay.addEventListener("change", toggleTimes);
  toggleTimes();

  const maps = byText("Open Maps", "a");
  maps?.addEventListener("click", () => {
    maps.href = "https://maps.google.com/?q=" + encodeURIComponent(fields.location.value);
  });

  byText("Replace flyer", "button")?.addEventListener("click", () => go(PAGES.upload));
  byText("Cancel & Discard", "button")?.addEventListener("click", () => {
    store.clear();
    go(PAGES.upload);
  });

  const form = document.getElementById("event-editor-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (fields.endDate.value < fields.startDate.value) {
      fields.endDate.setCustomValidity("End date can't be before the start date.");
      fields.endDate.reportValidity();
      return;
    }
    const event = {
      id: saved?.id ?? (crypto.randomUUID?.() ?? String(Date.now())),
      title: fields.title.value.trim(),
      allDay: fields.allDay.checked,
      startDate: fields.startDate.value,
      startTime: fields.startTime.value,
      endDate: fields.endDate.value,
      endTime: fields.endTime.value,
      location: fields.location.value.trim(),
      description: fields.description.value.trim(),
      reminder: fields.reminder.value,
      flyerName: flyer?.name ?? null,
      syncedAt: new Date().toISOString(),
    };
    store.set("event", event);
    recent.upsert(event);
    const btn = document.getElementById("submit-sync-btn");
    btn.disabled = true;
    btn.querySelector("span:last-child").textContent = "Syncing with Google Calendar...";
    setTimeout(() => go(PAGES.synced), 900);
  });
  fields.endDate.addEventListener("input", () => fields.endDate.setCustomValidity(""));
}

// ---------- Synced ----------

function parseLocal(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

function describeWhen(ev) {
  const start = parseLocal(ev.startDate, ev.startTime);
  const end = parseLocal(ev.endDate || ev.startDate, ev.endTime);
  const day = { month: "short", day: "numeric", year: "numeric" };
  const sameDay = ev.startDate === (ev.endDate || ev.startDate);
  const dates = sameDay
    ? start.toLocaleDateString(undefined, day)
    : `${start.toLocaleDateString(undefined, day)} – ${end.toLocaleDateString(undefined, day)}`;
  if (ev.allDay) return [dates, "All day"];
  const t = { hour: "numeric", minute: "2-digit" };
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(start).find((p) => p.type === "timeZoneName")?.value;
  return [dates, `${start.toLocaleTimeString(undefined, t)} – ${end.toLocaleTimeString(undefined, t)} ${zone ?? ""}`.trim()];
}

// The day after `date` (YYYY-MM-DD) as YYYYMMDD: all-day events end exclusively.
function dayAfter(date) {
  const d = parseLocal(date);
  d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

const compact = (date, time) => date.replace(/-/g, "") + (time ? "T" + time.replace(":", "") + "00" : "");

function icsEscape(text) {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);
}

function buildIcs(ev) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  let start, end;
  if (ev.allDay) {
    start = `DTSTART;VALUE=DATE:${compact(ev.startDate)}`;
    end = `DTEND;VALUE=DATE:${dayAfter(ev.endDate || ev.startDate)}`;
  } else {
    start = `DTSTART:${compact(ev.startDate, ev.startTime)}`;
    end = `DTEND:${compact(ev.endDate || ev.startDate, ev.endTime)}`;
  }
  const minutes = { "10m": 10, "30m": 30, "1h": 60, "1d": 1440 }[ev.reminder];
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bookmark//Flyer to Calendar//EN", "BEGIN:VEVENT",
    `UID:${Date.now()}@bookmark.local`, `DTSTAMP:${stamp}`, start, end,
    `SUMMARY:${icsEscape(ev.title)}`,
    ev.location && `LOCATION:${icsEscape(ev.location)}`,
    ev.description && `DESCRIPTION:${icsEscape(ev.description)}`,
    minutes && ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(ev.title)}`, `TRIGGER:-PT${minutes}M`, "END:VALARM"],
    "END:VEVENT", "END:VCALENDAR",
  ].flat().filter(Boolean);
  return lines.join("\r\n");
}

function googleCalendarUrl(ev) {
  let dates;
  if (ev.allDay) {
    dates = `${compact(ev.startDate)}/${dayAfter(ev.endDate || ev.startDate)}`;
  } else {
    dates = `${compact(ev.startDate, ev.startTime)}/${compact(ev.endDate || ev.startDate, ev.endTime)}`;
  }
  const params = new URLSearchParams({ action: "TEMPLATE", text: ev.title, dates, location: ev.location, details: ev.description });
  return "https://calendar.google.com/calendar/render?" + params;
}

function downloadIcs(event) {
  const url = URL.createObjectURL(new Blob([buildIcs(event)], { type: "text/calendar" }));
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: (event.title || "event").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() + ".ics",
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Shares through the phone's share sheet, or copies the details on a computer.
// Resolves to a short status to show, or null when the share sheet handled it.
async function shareEvent(event) {
  const [dates, times] = describeWhen(event);
  const text = `${event.title}\n${dates}, ${times}\n${event.location}`;
  if (navigator.share) {
    try { await navigator.share({ title: event.title, text }); } catch { /* user cancelled */ }
    return null;
  }
  try {
    await navigator.clipboard.writeText(text);
    return "Copied to clipboard";
  } catch {
    return "Couldn't copy";
  }
}

function recentRow(ev) {
  const [dates] = describeWhen(ev);
  const venue = ev.location.split(",")[0];
  return `
    <a href="${PAGES.recent}#${encodeURIComponent(ev.id)}" class="flex items-center justify-between p-space-sm rounded-lg bg-surface-container-lowest border border-surface-container-high hover:bg-surface-container-low transition-colors">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-primary flex-shrink-0">
          <span class="material-symbols-outlined text-[18px]">event</span>
        </div>
        <div class="flex flex-col min-w-0">
          <span class="font-title-md text-[13px] text-on-surface truncate">${escapeHtml(ev.title || "Untitled event")}</span>
          <span class="font-body-sm text-[12px] text-on-surface-variant truncate">${escapeHtml(venue ? `${dates} • ${venue}` : dates)}</span>
        </div>
      </div>
      <span class="font-label-mono text-[11px] text-secondary flex items-center gap-1 flex-shrink-0">
        <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>
        Added
      </span>
    </a>`;
}

function setUpSyncedPage() {
  const event = store.get("event");
  // This page only makes sense right after adding an event.
  if (!event) return go(PAGES.upload);

  byText("Convert Another Flyer", "a")?.addEventListener("click", () => store.clear());

  const [dates, times] = describeWhen(event);
  const [venue, ...rest] = event.location.split(",");
  document.getElementById("synced-title").textContent = event.title;
  document.getElementById("synced-dates").textContent = dates;
  document.getElementById("synced-times").textContent = times;
  document.getElementById("synced-venue").textContent = venue || "No location";
  document.getElementById("synced-address").textContent = rest.join(",").trim();

  // Testing phase: nothing was really synced, so this opens a prefilled Google Calendar event instead.
  const open = byText("Open in Google Calendar", "a");
  if (open) open.href = googleCalendarUrl(event);

  document.getElementById("quickDownloadIcs")?.addEventListener("click", (e) => {
    e.preventDefault();
    downloadIcs(event);
  });

  const share = document.getElementById("quickShareInvite");
  share?.addEventListener("click", async (e) => {
    e.preventDefault();
    const status = await shareEvent(event);
    if (!status) return;
    const label = share.querySelector("span:last-child");
    label.textContent = status;
    setTimeout(() => (label.textContent = "Share invite"), 2000);
  });

  // Earlier events, not the one just added.
  accountReady.then(() => {
    const others = recent.list().filter((e) => e.id !== event.id);
    const section = document.getElementById("recent");
    if (!others.length) return section.classList.add("hidden");
    document.getElementById("recent-list").innerHTML = others.slice(0, 3).map(recentRow).join("");
  });
}

// ---------- Recent Events ----------

function recentCard(ev) {
  const [dates, times] = describeWhen(ev);
  const added = new Date(ev.syncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const action = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-label-md text-label-md transition-colors";
  return `
    <article id="${escapeHtml(ev.id)}" class="p-space-md rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-space-sm scroll-mt-24">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center text-primary flex-shrink-0">
          <span class="material-symbols-outlined">event</span>
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="font-title-md text-title-md text-on-surface break-words">${escapeHtml(ev.title || "Untitled event")}</h2>
          <p class="font-body-sm text-body-sm text-on-surface-variant">${escapeHtml(dates)} • ${escapeHtml(times)}</p>
          ${ev.location ? `<p class="font-body-sm text-body-sm text-on-surface-variant break-words">${escapeHtml(ev.location)}</p>` : ""}
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2 pt-space-xs border-t border-surface-container-high">
        <span class="font-label-mono text-label-mono text-on-surface-variant">Added ${escapeHtml(added)}${ev.flyerName ? ` • from ${escapeHtml(ev.flyerName)}` : ""}</span>
        <div class="flex flex-wrap gap-1">
          <a class="${action} text-primary hover:bg-surface-container-high" href="${escapeHtml(googleCalendarUrl(ev))}" target="_blank" rel="noopener noreferrer">
            <span class="material-symbols-outlined text-[18px]">calendar_today</span>Google Calendar
          </a>
          <button type="button" data-action="ics" class="${action} text-on-surface-variant hover:bg-surface-container-high">
            <span class="material-symbols-outlined text-[18px]">download</span>.ics
          </button>
          <button type="button" data-action="share" class="${action} text-on-surface-variant hover:bg-surface-container-high">
            <span class="material-symbols-outlined text-[18px]">share</span><span>Share</span>
          </button>
          <button type="button" data-action="remove" class="${action} text-error hover:bg-surface-container-high" aria-label="Remove ${escapeHtml(ev.title || "event")}">
            <span class="material-symbols-outlined text-[18px]">delete</span>Remove
          </button>
        </div>
      </div>
    </article>`;
}

async function setUpRecentPage() {
  await accountReady;
  const listEl = document.getElementById("recent-events");
  const emptyEl = document.getElementById("recent-empty");
  const countEl = document.getElementById("recent-count");

  const render = () => {
    const items = recent.list();
    listEl.innerHTML = items.map(recentCard).join("");
    emptyEl.classList.toggle("hidden", items.length > 0);
    countEl.textContent = items.length === 1 ? "1 event" : `${items.length} events`;
  };
  render();

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.closest("article").id;
    const ev = recent.list().find((x) => x.id === id);
    if (!ev) return;
    if (btn.dataset.action === "ics") downloadIcs(ev);
    if (btn.dataset.action === "remove") {
      recent.remove(id);
      render();
    }
    if (btn.dataset.action === "share") {
      const status = await shareEvent(ev);
      if (!status) return;
      const label = btn.querySelector("span:last-child");
      label.textContent = status;
      setTimeout(() => (label.textContent = "Share"), 2000);
    }
  });

  // Arriving from a row on the synced page: bring that event into view.
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "center" });
}

// ---------- Start ----------

renderHeader();
wireNav();
const accountReady = requireAccount();
const page = document.body.dataset.page;
if (page === "upload") setUpUploadPage();
if (page === "review") setUpReviewPage();
if (page === "synced") setUpSyncedPage();
if (page === "recent") setUpRecentPage();
