// Testing-phase glue for the Stitch screens: Google sign-in, page links, the uploaded flyer,
// and the event the user confirms. The flyer is sent to the backend for OCR; no Calendar calls
// yet. Flyer and event state lives in sessionStorage so it resets when the tab closes.

// Backend base URL. Empty means same origin: the backend serves this site, and `npm run dev`
// proxies /api to it. Set it (e.g. "https://api.example.com") if the front end is hosted apart.
const API_BASE = "";

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
    for (const key of ["flyer", "event", "events", "reviewState", "created"]) sessionStorage.removeItem(key);
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

// Sends the photo to the backend. Resolves to { text, events, parseError } or { error: "message to show" }.
async function extractFlyerText(file) {
  const body = new FormData();
  body.append("file", file);
  body.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
  body.append("reference_datetime", new Date().toISOString());
  try {
    const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error?.message || `Upload failed (${res.status}).` };
    return { text: data.text, events: data.events || [], parseError: data.parse_error || null };
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
  showScanStatus("Reading your flyer...", "Finding the title, date, time and place. This takes about 10 seconds.");
  const [flyer, ocr] = await Promise.all([readFlyer(file), extractFlyerText(file)]);
  if (ocr.error) {
    showScanStatus("Couldn't read that flyer", ocr.error, { failed: true });
    document.getElementById("flyer-file-input").value = ""; // let the same file be picked again
    return;
  }
  store.clear();
  const saved = { ...flyer, text: ocr.text, events: ocr.events, parseError: ocr.parseError };
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

// "2026-10-28T17:00:00-07:00" -> ["2026-10-28", "17:00"]. A date with no time gives ["2026-10-28", ""].
function splitIso(iso) {
  const m = (iso || "").match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  return m ? [m[1], m[2] || ""] : ["", ""];
}

// One event from the backend -> the editable state for the form, plus which fields to flag.
function eventToState(ev) {
  const [startDate, startTime] = splitIso(ev.start);
  const [endDate, endTime] = splitIso(ev.end);
  const conf = ev.confidence || {};
  return {
    title: ev.title || "",
    allDay: Boolean(startDate) && !startTime,
    startDate, startTime,
    endDate: endDate || startDate,
    endTime,
    location: ev.location || "",
    description: ev.description || "",
    reminder: "1h",
    include: true,
    // true = flag this group of fields for the user to check
    warn: {
      title: !ev.title,
      start: !startDate || conf.start !== "high",
      end: Boolean(ev.end_defaulted),
      location: !ev.location || conf.location !== "high",
    },
  };
}

function blankState(description = "") {
  return { ...eventToState({}), description };
}

function setUpReviewPage() {
  const flyer = store.get("flyer");
  if (!flyer) return go(PAGES.upload); // nothing uploaded yet
  const fields = reviewFields();
  const form = document.getElementById("event-editor-form");

  // ----- Source flyer panel
  const nameEl = byText("spring-summit-2025.jpg", "p");
  if (nameEl) {
    nameEl.textContent = flyer.name;
    nameEl.nextElementSibling.textContent = flyer.width
      ? `${formatSize(flyer.size)} • ${flyer.width} × ${flyer.height}px`
      : `${formatSize(flyer.size)} • preview not available for this file type`;
  }
  const original = byText("View original", "a");
  if (flyer.preview) {
    document.getElementById("scanned-image").src = flyer.preview;
    if (original) original.href = dataUrlToBlobUrl(flyer.preview);
  } else {
    // No preview (for example HEIC, which most browsers can't draw): say so instead of a broken image.
    const img = document.getElementById("scanned-image");
    img.classList.add("hidden");
    img.parentElement.insertAdjacentHTML("beforeend", '<div class="absolute inset-0 flex items-center justify-center p-space-md text-center font-body-sm text-body-sm text-on-surface-variant">Preview not available for this file type</div>');
    original?.classList.add("hidden");
  }

  // ----- The events: returning from the synced page restores the user's edits
  const restored = store.get("reviewState");
  let states, active = 0;
  if (restored) {
    ({ events: states, active } = restored);
  } else if (flyer.events?.length) {
    states = flyer.events.map(eventToState);
  } else {
    states = [blankState(flyer.text || "")]; // nothing parsed: keep the raw text for the user
  }

  // ----- Notice at the top of the form
  const notice = document.createElement("div");
  notice.id = "extract-notice";
  form.firstElementChild.after(notice);
  function showNotice() {
    let kind = "info", text;
    if (flyer.parseError || !flyer.events?.length) {
      kind = "warn";
      text = flyer.parseError
        ? `We read your flyer but couldn't pick out the event details. ${flyer.parseError} The flyer's text is in Description, so you can fill in the rest below.`
        : "We read your flyer but couldn't find an event in it. The flyer's text is in Description. Fill in the details below.";
    } else {
      const flagged = states.some((st) => Object.values(st.warn).some(Boolean));
      const many = states.length > 1 ? `Found ${states.length} events on this flyer. ` : "";
      text = many + (flagged ? "Highlighted fields need a quick check against the flyer." : "Everything was read clearly. Take a quick look before adding it.");
      kind = flagged ? "warn" : "ok";
    }
    notice.className = `notice notice-${kind}`;
    notice.textContent = text;
  }

  // ----- Tabs, one per event (only shown when there is more than one)
  const tabs = document.createElement("div");
  tabs.id = "event-tabs";
  notice.after(tabs);
  const includeRow = document.createElement("label");
  includeRow.className = "flex items-center gap-space-xs cursor-pointer font-body-sm text-body-sm text-on-surface-variant";
  includeRow.innerHTML = '<input type="checkbox" id="include-event" class="w-4 h-4 rounded accent-primary cursor-pointer"><span>Add this event to my calendar</span>';
  tabs.after(includeRow);
  const includeBox = includeRow.querySelector("input");

  function renderTabs() {
    const many = states.length > 1;
    tabs.classList.toggle("hidden", !many);
    includeRow.classList.toggle("hidden", !many);
    tabs.replaceChildren(...states.map((st, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "event-tab" + (i === active ? " active" : "") + (st.include ? "" : " excluded");
      const flagged = Object.values(st.warn).some(Boolean);
      b.textContent = `${i + 1}. ${st.title || "Untitled event"}`;
      if (flagged) b.insertAdjacentHTML("beforeend", '<span class="tab-dot" title="Has fields to check"></span>');
      b.addEventListener("click", () => show(i));
      return b;
    }));
  }

  // ----- Field highlighting
  const hints = {};
  function hintFor(group, anchor) {
    if (!hints[group]) {
      hints[group] = document.createElement("p");
      hints[group].className = "field-hint";
      anchor.after(hints[group]);
    }
    return hints[group];
  }
  const groupEls = {
    title: [fields.title],
    start: [fields.startDate, fields.startTime],
    end: [fields.endDate, fields.endTime],
    location: [fields.location],
  };
  function applyWarnings() {
    const st = states[active];
    for (const [group, els] of Object.entries(groupEls)) els.forEach((el) => el.classList.toggle("field-warn", st.warn[group]));
    const messages = {
      title: st.warn.title ? "No title found on the flyer. Add one." : "",
      date: [
        st.warn.start ? (st.startDate ? "Check this date and time against the flyer." : "No date found on the flyer. Pick one.") : "",
        st.warn.end ? "No end time on the flyer, so it defaults to 1 hour. Adjust it if needed." : "",
      ].filter(Boolean).join(" "),
      location: st.warn.location ? (st.location ? "Check this location against the flyer." : "No location found on the flyer.") : "",
    };
    hintFor("title", fields.title).textContent = messages.title;
    hintFor("date", fields.startDate.closest(".grid")).textContent = messages.date;
    hintFor("location", fields.location.closest(".relative")).textContent = messages.location;
  }

  // ----- Form <-> state
  function readForm() {
    const st = states[active];
    Object.assign(st, {
      title: fields.title.value.trim(),
      allDay: fields.allDay.checked,
      startDate: fields.startDate.value, startTime: fields.startTime.value,
      endDate: fields.endDate.value, endTime: fields.endTime.value,
      location: fields.location.value.trim(),
      description: fields.description.value.trim(),
      reminder: fields.reminder.value,
      include: includeBox.checked,
    });
  }
  function fillForm() {
    const st = states[active];
    fields.title.value = st.title;
    fields.allDay.checked = st.allDay;
    fields.startDate.value = st.startDate; fields.startTime.value = st.startTime;
    fields.endDate.value = st.endDate; fields.endTime.value = st.endTime;
    fields.location.value = st.location;
    fields.description.value = st.description;
    fields.reminder.value = st.reminder;
    includeBox.checked = st.include;
    toggleTimes();
    applyWarnings();
    renderTabs();
  }
  function show(i) {
    readForm();
    active = i;
    fillForm();
  }

  const toggleTimes = () => {
    fields.startTime.disabled = fields.endTime.disabled = fields.allDay.checked;
    fields.startTime.classList.toggle("opacity-40", fields.allDay.checked);
    fields.endTime.classList.toggle("opacity-40", fields.allDay.checked);
  };
  fields.allDay.addEventListener("change", toggleTimes);

  // Editing a flagged field clears its flag.
  for (const [group, els] of Object.entries(groupEls)) {
    els.forEach((el) => el.addEventListener("input", () => {
      states[active].warn[group] = false;
      applyWarnings();
      renderTabs();
      showNotice();
    }));
  }
  fields.title.addEventListener("input", () => { states[active].title = fields.title.value.trim(); renderTabs(); });
  includeBox.addEventListener("change", () => { states[active].include = includeBox.checked; renderTabs(); });

  const maps = byText("Open Maps", "a");
  maps?.addEventListener("click", () => {
    maps.href = "https://maps.google.com/?q=" + encodeURIComponent(fields.location.value);
  });

  byText("Replace flyer", "button")?.addEventListener("click", () => go(PAGES.upload));
  byText("Cancel & Discard", "button")?.addEventListener("click", () => {
    store.clear();
    go(PAGES.upload);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    readForm();
    const chosen = states.filter((st) => st.include);
    if (!chosen.length) {
      notice.className = "notice notice-warn";
      notice.textContent = "Tick “Add this event to my calendar” on at least one event.";
      return;
    }
    // Check every event we're about to add, not just the one on screen.
    for (const st of chosen) {
      const i = states.indexOf(st);
      const problem = !st.title ? "title" : !st.startDate ? "startDate" : !st.allDay && !st.startTime ? "startTime" : st.endDate && st.endDate < st.startDate ? "endDate" : null;
      if (!problem) continue;
      if (i !== active) show(i);
      const field = fields[problem];
      field.setCustomValidity(problem === "endDate" ? "End date can't be before the start date." : "");
      field.reportValidity();
      field.addEventListener("input", () => field.setCustomValidity(""), { once: true });
      return;
    }
    for (const st of chosen) {
      st.endDate ||= st.startDate;
      if (!st.allDay) st.endTime ||= st.startTime; // no end time given: the event is a point in time
    }
    store.set("reviewState", { events: states, active });
    store.set("events", chosen.map(({ warn, include, ...ev }) => ev));
    store.set("event", { ...chosen[0], warn: undefined, include: undefined });
    sessionStorage.removeItem("created"); // edited details need adding again
    go(PAGES.synced);
  });

  const confirmBtn = document.getElementById("submit-sync-btn");
  confirmBtn.querySelector("span:last-child").textContent = "Confirm details";
  confirmBtn.querySelector(".material-symbols-outlined").textContent = "check";

  showNotice();
  fillForm();
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

function buildIcs(events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const vevents = events.map((ev, n) => buildVevent(ev, n, stamp));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bookmark//Flyer to Calendar//EN", ...vevents.flat(), "END:VCALENDAR"].join("\r\n");
}

function buildVevent(ev, n, stamp) {
  let start, end;
  if (ev.allDay) {
    start = `DTSTART;VALUE=DATE:${compact(ev.startDate)}`;
    end = `DTEND;VALUE=DATE:${dayAfter(ev.endDate || ev.startDate)}`;
  } else {
    start = `DTSTART:${compact(ev.startDate, ev.startTime)}`;
    end = `DTEND:${compact(ev.endDate || ev.startDate, ev.endTime)}`;
  }
  const minutes = { "10m": 10, "30m": 30, "1h": 60, "1d": 1440 }[ev.reminder];
  return [
    "BEGIN:VEVENT",
    `UID:${Date.now()}-${n}@bookmark.local`, `DTSTAMP:${stamp}`, start, end,
    `SUMMARY:${icsEscape(ev.title)}`,
    ev.location && `LOCATION:${icsEscape(ev.location)}`,
    ev.description && `DESCRIPTION:${icsEscape(ev.description)}`,
    minutes && ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(ev.title)}`, `TRIGGER:-PT${minutes}M`, "END:VALARM"],
    "END:VEVENT",
  ].flat().filter(Boolean);
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

// Page 04 is where the events actually get added to Google Calendar.
const SIGN_IN_AGAIN = new Set(["NOT_SIGNED_IN", "CALENDAR_NOT_CONNECTED", "TOKEN_EXPIRED", "CALENDAR_PERMISSION_MISSING"]);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function replaceText(from, to) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue.includes(from)) node.nodeValue = node.nodeValue.replace(from, to);
  }
}

// Asks the backend to create one event on the user's primary calendar. Resolves to { link } or { error, code }.
async function createCalendarEvent(ev) {
  const body = {
    title: ev.title, all_day: ev.allDay,
    start_date: ev.startDate, start_time: ev.startTime || null,
    end_date: ev.endDate || null, end_time: ev.endTime || null,
    location: ev.location, description: ev.description, reminder: ev.reminder,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  try {
    const res = await fetch(`${API_BASE}/api/events`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error?.message || `Couldn't add the event (${res.status}).`, code: data.error?.code };
    return { link: data.htmlLink };
  } catch {
    return { error: "Couldn't reach the server. Check your connection and try again." };
  }
}

function setUpSyncedPage() {
  const events = store.get("events");
  if (!events?.length) return go(PAGES.upload); // nothing to add yet
  const ev = events[0];

  byText("Convert Another Flyer", "a")?.addEventListener("click", () => store.clear());

  // ----- Summary card: the first event, plus a list when there are more
  const [dates, times] = describeWhen(ev);
  const [venue, ...rest] = ev.location.split(",");
  document.getElementById("synced-title").textContent = ev.title;
  document.getElementById("synced-dates").textContent = dates;
  document.getElementById("synced-times").textContent = times;
  document.getElementById("synced-venue").textContent = venue || "No location";
  document.getElementById("synced-address").textContent = rest.join(",").trim();
  if (events.length > 1) {
    const list = el("ul", "mt-space-md pt-space-md border-t border-surface-container-high text-left font-body-sm text-body-sm text-on-surface-variant flex flex-col gap-1");
    list.append(el("li", "font-label-mono text-label-mono uppercase", `Also adding ${events.length - 1} more`));
    events.slice(1).forEach((e) => list.append(el("li", "", `${e.title}: ${describeWhen(e).join(", ")}`)));
    document.getElementById("synced-title").closest("div").append(list);
  }

  // ----- Page text that depends on whether the events were added yet
  const headline = document.querySelector("main h1");
  const subline = headline.nextElementSibling;
  replaceText("Synced to", "Signed in as");
  const many = events.length > 1;
  const setState = (added) => {
    headline.textContent = added
      ? (many ? `${events.length} events added to your Google Calendar!` : "Event added to your Google Calendar!")
      : (many ? "Ready to add these events to your Google Calendar" : "Ready to add this event to your Google Calendar");
    subline.textContent = added
      ? "They are on your primary calendar now."
      : "Check the details below, then add it with one click.";
    const tag = added ? "ADDED" : "READY TO ADD";
    for (const from of ["CALENDAR CONFIRMED", "READY TO ADD", "ADDED"]) if (from !== tag) replaceText(from, tag);
  };

  // ----- The Add button
  const addBtn = byText("Open in Google Calendar", "a");
  const addLabel = addBtn.querySelector("span:last-child");
  const addIcon = addBtn.querySelector(".material-symbols-outlined");
  addBtn.removeAttribute("target");
  addBtn.href = "#";
  const result = el("div", "w-full flex flex-col gap-space-sm text-left mt-space-md");
  addBtn.parentElement.after(result);

  const created = store.get("created") || {}; // index -> link, for events already added
  const label = (text, icon) => { addLabel.textContent = text; addIcon.textContent = icon; };
  const disable = (on) => {
    addBtn.classList.toggle("pointer-events-none", on);
    addBtn.classList.toggle("opacity-60", on);
    addBtn.setAttribute("aria-disabled", String(on));
  };

  function showResults(failures) {
    result.replaceChildren();
    events.forEach((e, i) => {
      if (!created[i]) return;
      const a = el("a", "notice notice-ok flex items-center justify-between gap-space-sm", "");
      a.href = created[i]; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.append(el("span", "", `Added: ${e.title}`), el("span", "font-semibold underline", "Open in Google Calendar"));
      result.append(a);
    });
    for (const { i, error, code } of failures) {
      const box = el("div", "notice notice-error flex flex-col gap-1");
      box.append(el("span", "font-semibold", events.length > 1 ? `Couldn't add “${events[i].title}”` : "Couldn't add the event"), el("span", "", error));
      const links = el("div", "flex flex-wrap gap-space-md font-semibold");
      if (SIGN_IN_AGAIN.has(code)) {
        const signIn = el("a", "underline", "Sign in again");
        signIn.href = `${API_BASE}/api/auth/google/login?next=${encodeURIComponent(PAGES.synced)}`;
        links.append(signIn);
      }
      const fallback = el("a", "underline", "Open a pre-filled Google Calendar page instead");
      fallback.href = googleCalendarUrl(events[i]); fallback.target = "_blank"; fallback.rel = "noopener noreferrer";
      links.append(fallback);
      box.append(links);
      result.append(box);
    }
  }

  const allAdded = () => events.every((_, i) => created[i]);
  if (allAdded()) { // coming back to this page after adding
    setState(true); label("Added to Google Calendar", "check_circle"); disable(true); showResults([]);
  } else {
    setState(false); label("Add to Google Calendar", "event_available"); showResults([]);
  }

  let busy = false;
  addBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (busy || allAdded()) return; // no double adds
    busy = true; disable(true); label("Adding to Google Calendar...", "sync");
    addIcon.classList.add("animate-spin");
    const failures = [];
    for (let i = 0; i < events.length; i++) {
      if (created[i]) continue;
      const out = await createCalendarEvent(events[i]);
      if (out.link) created[i] = out.link; else failures.push({ i, ...out });
    }
    store.set("created", created);
    addIcon.classList.remove("animate-spin");
    showResults(failures);
    busy = false;
    if (allAdded()) {
      setState(true); label("Added to Google Calendar", "check_circle"); // stays disabled
    } else {
      disable(false); label("Try again", "refresh");
    }
  });

  // ----- Download / share
  document.getElementById("quickDownloadIcs")?.addEventListener("click", (e) => {
    e.preventDefault();
    const url = URL.createObjectURL(new Blob([buildIcs(events)], { type: "text/calendar" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: (ev.title || "event").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() + ".ics",
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const share = document.getElementById("quickShareInvite");
  share?.addEventListener("click", async (e) => {
    e.preventDefault();
    const text = events.map((x) => `${x.title}\n${describeWhen(x).join(", ")}\n${x.location}`).join("\n\n");
    if (navigator.share) {
      try { await navigator.share({ title: ev.title, text }); } catch { /* user cancelled */ }
      return;
    }
    const shareLabel = share.querySelector("span:last-child");
    try {
      await navigator.clipboard.writeText(text);
      shareLabel.textContent = "Copied to clipboard";
    } catch {
      shareLabel.textContent = "Couldn't copy";
    }
    setTimeout(() => (shareLabel.textContent = "Share invite"), 2000);
  });
}

// ---------- Start ----------

wireNav();
requireAccount();
const page = document.body.dataset.page;
if (page === "upload") setUpUploadPage();
if (page === "review") setUpReviewPage();
if (page === "synced") setUpSyncedPage();
