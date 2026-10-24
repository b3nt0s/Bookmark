// Testing-phase glue for the Stitch screens: Google sign-in, page links, the uploaded flyer,
// and the event the user confirms. No real OCR or Calendar calls yet; flyer and event state
// lives in sessionStorage so it resets when the tab closes.

const PAGES = {
  signIn: "/",
  upload: "/screens/02-upload-or-snap-flyer-bookmark.html",
  review: "/screens/03-review-confirm-event-bookmark.html",
  synced: "/screens/04-event-synced-google-calendar.html",
};

// Where each nav link (data-path) in the Stitch header and footer goes.
const NAV = {
  "upload-flyer": PAGES.upload,
  "recent-events": PAGES.synced + "#recent",
  "google-calendar-sync": PAGES.synced,
  "how-it-works": PAGES.signIn,
};

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

function go(url) {
  window.location.href = url;
}

// Finds the innermost clickable element whose text includes `text`.
function byText(text, selector = "button, a") {
  return [...document.querySelectorAll(selector)].find((el) => el.textContent.includes(text));
}

// ---------- Account ----------

// The Stitch screens show a placeholder account; this is it.
const PLACEHOLDER_EMAIL = "alex.doe@gmail.com";

function showAccount(user) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue.includes(PLACEHOLDER_EMAIL)) {
      node.nodeValue = node.nodeValue.replaceAll(PLACEHOLDER_EMAIL, user.email);
    }
  }

  const avatar = document.querySelector('img[alt="Profile"]');
  if (!avatar) return;
  if (user.picture) {
    avatar.src = user.picture;
    avatar.referrerPolicy = "no-referrer"; // Google profile photos refuse some referrers
  }
  avatar.alt = user.name;
  avatar.title = `${user.name} (${user.email})`;

  const signOut = document.createElement("button");
  signOut.type = "button";
  signOut.textContent = "Sign out";
  signOut.className = "ml-3 px-3 py-1.5 rounded-full border border-outline-variant/60 text-on-surface-variant hover:text-on-surface hover:bg-surface-container font-label-md text-label-md";
  signOut.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    store.clear();
    go(PAGES.signIn);
  });
  avatar.closest("a").after(signOut);
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

async function acceptFlyer(file) {
  if (!file) return;
  document.getElementById("processing-banner")?.classList.remove("hidden");
  const flyer = await readFlyer(file);
  store.clear();
  if (!store.set("flyer", flyer)) store.set("flyer", { ...flyer, preview: null });
  // Short pause so the "scanning" banner is visible, like the real OCR step will be.
  setTimeout(() => go(PAGES.review), 1200);
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
    store.set("event", {
      title: fields.title.value.trim(),
      allDay: fields.allDay.checked,
      startDate: fields.startDate.value,
      startTime: fields.startTime.value,
      endDate: fields.endDate.value,
      endTime: fields.endTime.value,
      location: fields.location.value.trim(),
      description: fields.description.value.trim(),
      reminder: fields.reminder.value,
    });
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

function setUpSyncedPage() {
  const ev = store.get("event");

  byText("Convert Another Flyer", "a")?.addEventListener("click", () => store.clear());
  if (ev) {
    const [dates, times] = describeWhen(ev);
    const [venue, ...rest] = ev.location.split(",");
    document.getElementById("synced-title").textContent = ev.title;
    document.getElementById("synced-dates").textContent = dates;
    document.getElementById("synced-times").textContent = times;
    document.getElementById("synced-venue").textContent = venue || "No location";
    document.getElementById("synced-address").textContent = rest.join(",").trim();

    // Testing phase: nothing was really synced, so this opens a prefilled Google Calendar event instead.
    const open = byText("Open in Google Calendar", "a");
    if (open) open.href = googleCalendarUrl(ev);
  }

  const event = ev ?? {
    title: document.getElementById("synced-title").textContent.trim(),
    allDay: false, startDate: "2025-05-14", startTime: "09:00", endDate: "2025-05-15", endTime: "17:00",
    location: "Metropolitan Convention Hall, 450 Market St, San Francisco, CA 94105", description: "", reminder: "1h",
  };

  document.getElementById("quickDownloadIcs")?.addEventListener("click", (e) => {
    e.preventDefault();
    const url = URL.createObjectURL(new Blob([buildIcs(event)], { type: "text/calendar" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: (event.title || "event").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() + ".ics",
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const share = document.getElementById("quickShareInvite");
  share?.addEventListener("click", async (e) => {
    e.preventDefault();
    const [dates, times] = describeWhen(event);
    const text = `${event.title}\n${dates}, ${times}\n${event.location}`;
    if (navigator.share) {
      try { await navigator.share({ title: event.title, text }); } catch { /* user cancelled */ }
      return;
    }
    const label = share.querySelector("span:last-child");
    try {
      await navigator.clipboard.writeText(text);
      label.textContent = "Copied to clipboard";
    } catch {
      label.textContent = "Couldn't copy";
    }
    setTimeout(() => (label.textContent = "Share invite"), 2000);
  });
}

// ---------- Start ----------

wireNav();
requireAccount();
const page = document.body.dataset.page;
if (page === "upload") setUpUploadPage();
if (page === "review") setUpReviewPage();
if (page === "synced") setUpSyncedPage();
