// Gmail Auto CC — content script
//
// Behavior:
// - Settings live in chrome.storage.sync as `rules: [{from, cc, enabled}]`.
// - For every visible compose, each enabled rule is applied independently:
//     * if the rule's `from` matches the current sender, ensure its `cc` is
//       in the Cc field (revealing the Cc field if needed).
//     * if it doesn't match, ensure the rule's `cc` is NOT in the Cc field.
// - A rule with empty `from` matches every compose.
// - When the user changes the From in an open compose, the next tick re-runs
//   the rules, so CCs swap automatically.
//
// Works on English and French Gmail UIs.

const LOG = (...args) => console.log("[Gmail Auto CC]", ...args);

let RULES = []; // [{ from: string (lc), cc: string, enabled: bool }]

// Normalize for comparison: lowercase, trim, and strip zero-width / NBSP
// characters that can sneak in from copy-paste.
function normalizeEmail(s) {
  return (s || "")
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .toLowerCase()
    .trim();
}

function parseRules(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({
      from: normalizeEmail(r && r.from),
      cc: ((r && r.cc) || "").trim(),
      enabled: !(r && r.enabled === false), // missing / undefined → enabled
    }))
    .filter((r) => r.cc);
}

// Migrate legacy single-pair settings to a one-item rules array.
function migrateLegacy(data) {
  const cc = ((data && data.cc) || "").trim();
  const matchFrom = normalizeEmail(data && data.matchFrom);
  if (!cc) return [];
  return [{ from: matchFrom, cc, enabled: true }];
}

chrome.storage.sync.get(["rules", "cc", "matchFrom"], (data) => {
  if (Array.isArray(data.rules)) {
    RULES = parseRules(data.rules);
  } else {
    RULES = migrateLegacy(data);
    if (RULES.length) {
      // Persist the migration so the options page sees rules immediately.
      chrome.storage.sync.set({ rules: RULES });
    }
  }
  LOG("loaded rules:", RULES);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.rules) {
    RULES = parseRules(changes.rules.newValue);
    LOG("rules changed:", RULES);
  }
});

// --- selectors (EN + FR) ---------------------------------------------------

function findAllComposes() {
  return document.querySelectorAll('div[role="dialog"]');
}

function findToInput(root = document) {
  return (
    root.querySelector('input[aria-label="To recipients"]') ||
    root.querySelector('input[aria-label*="To " i][type="text"]') ||
    root.querySelector('input[aria-label^="Destinataires" i][type="text"]')
  );
}

function findCcInput(root = document) {
  const inputs = root.querySelectorAll('input[type="text"][aria-label]');
  for (const el of inputs) {
    const a = (el.getAttribute("aria-label") || "").toLowerCase();
    // Exclude Bcc / Cci / Blind / Cachée
    if (/\bbcc\b|\bcci\b|blind|cach/.test(a)) continue;
    // Match Cc / Copie (FR)
    if (/\bcc\b/.test(a)) return el;
    if (a.includes("copie")) return el; // French "Destinataires en copie"
  }
  return null;
}

function findCcToggle(root = document) {
  // Pass 1: span[role=link] with text "Cc" and parens in aria-label
  // (the keyboard shortcut hint reliably distinguishes the toggle from the
  // contact-picker link that also reads "Cc").
  const links = root.querySelectorAll('span[role="link"]');
  let textOnlyMatch = null;
  let textOnlyCount = 0;
  for (const el of links) {
    const t = el.textContent.trim();
    if (t !== "Cc") continue;
    const aria = el.getAttribute("aria-label") || "";
    if (aria.includes("(")) return el;
    textOnlyMatch = el;
    textOnlyCount++;
  }
  // Pass 2: fall back to a single text-only "Cc" link.
  if (textOnlyCount === 1) return textOnlyMatch;

  // Pass 3: any clickable element whose aria-label looks like an "add cc" hint.
  const candidates = root.querySelectorAll(
    'span[role="link"], span[role="button"], button, [role="button"]'
  );
  for (const el of candidates) {
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (/\bbcc\b|\bcci\b/.test(aria)) continue;
    if (
      (/\bcc\b/.test(aria) && /(add|show|recipient)/.test(aria)) ||
      aria.includes("ajouter cc") ||
      aria.includes("afficher cc")
    ) {
      return el;
    }
  }
  return null;
}

// The From row has a <label>From</label> / <label>De</label> followed by a
// span with "Name <email@addr>".
function findFromEmail(root = document) {
  const labels = root.querySelectorAll("label");
  for (const label of labels) {
    const t = label.textContent.trim();
    if (t !== "From" && t !== "De" && t !== "De :") continue;
    const row =
      label.closest("tr") ||
      label.parentElement?.parentElement ||
      label.parentElement;
    if (!row) continue;
    for (const span of row.querySelectorAll("span, div")) {
      if (span.children.length > 0) continue;
      const m = span.textContent.match(/<([^<>@\s]+@[^<>\s]+)>/);
      if (m) return normalizeEmail(m[1]);
      const m2 = span.textContent.match(/([\w.+-]+@[\w.-]+\.\w+)/);
      if (m2) return normalizeEmail(m2[1]);
    }
  }
  return null;
}

// When the user has a single account, Gmail omits the From row entirely.
// Fall back to the logged-in account's email, which Gmail exposes on the
// account-switcher button in the top-right. Its aria-label is something like:
//   "Google Account: Jane Doe\n(jane@example.com)"
//   "Compte Google : Jane Doe\n(jane@example.com)"
function findPrimaryAccountEmail() {
  const selectors = [
    'a[aria-label*="Google Account" i]',
    'a[aria-label*="Compte Google" i]',
    '[aria-label*="Google Account" i]',
    '[aria-label*="Compte Google" i]',
  ];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const label = el.getAttribute("aria-label") || "";
      const m = label.match(/([\w.+-]+@[\w.-]+\.\w+)/);
      if (m) return normalizeEmail(m[1]);
    }
  }
  return null;
}

// Chips live as siblings near the Cc input. Walk up from the Cc input to
// find a container that holds chips, then filter by hovercard-id.
function findCcChip(ccInput, email) {
  if (!ccInput || !email) return null;
  const target = email.toLowerCase();
  let container = ccInput;
  for (let i = 0; i < 10 && container; i++) {
    container = container.parentElement;
    if (!container) break;
    const chips = container.querySelectorAll(
      'div[role="option"][data-hovercard-id]'
    );
    for (const chip of chips) {
      const hc = (chip.getAttribute("data-hovercard-id") || "").toLowerCase();
      if (hc === target) return chip;
    }
    if (chips.length > 0) return null; // correct row, but no matching chip
  }
  return null;
}

// --- write / erase ---------------------------------------------------------

function setNativeValue(el, value) {
  const proto =
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function hasCc(compose, ccAddress) {
  if (!ccAddress) return false;
  const ccInput = findCcInput(compose);
  if (!ccInput) return false;
  const v = (ccInput.value || "").toLowerCase();
  if (v.includes(ccAddress.toLowerCase())) return true;
  if (findCcChip(ccInput, ccAddress)) return true;
  return false;
}

// Append `ccAddress` to the Cc input. Returns true if successful.
function writeCc(compose, ccAddress) {
  const ccInput = findCcInput(compose);
  if (!ccInput || ccInput.offsetParent === null) return false;
  const existing = (ccInput.value || "").trim();
  if (existing.toLowerCase().includes(ccAddress.toLowerCase())) return true;
  const newValue = existing ? `${existing}, ${ccAddress}` : ccAddress;
  ccInput.focus();
  setNativeValue(ccInput, newValue);
  LOG("added Cc:", ccAddress);
  return true;
}

function removeCc(compose, ccAddress) {
  const ccInput = findCcInput(compose);
  if (!ccInput) return;

  // Strip from the input value (still plain text)
  const val = ccInput.value || "";
  if (val.toLowerCase().includes(ccAddress.toLowerCase())) {
    const pattern = new RegExp(
      `\\s*,?\\s*${ccAddress.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,?\\s*`,
      "i"
    );
    const cleaned = val.replace(pattern, ",").replace(/^,|,$/g, "").trim();
    setNativeValue(ccInput, cleaned);
    LOG("cleared Cc plain text for:", ccAddress);
  }

  // Remove chips Gmail may have created.
  let chip = findCcChip(ccInput, ccAddress);
  while (chip) {
    chip.remove();
    LOG("removed Cc chip for:", ccAddress);
    chip = findCcChip(ccInput, ccAddress);
  }
}

function dumpComposeForDebug(compose, tag) {
  const inputs = [...compose.querySelectorAll("input[aria-label]")].map((el) => ({
    type: el.type,
    aria: el.getAttribute("aria-label"),
    visible: el.offsetParent !== null,
    value: el.value,
  }));
  const links = [
    ...compose.querySelectorAll(
      'span[role="link"], [role="button"], button, span'
    ),
  ]
    .filter((el) => /^(cc|cci|bcc|copie)$/i.test(el.textContent.trim()))
    .map((el) => ({
      tag: el.tagName,
      role: el.getAttribute("role"),
      text: el.textContent.trim(),
      aria: el.getAttribute("aria-label"),
    }));
  LOG(`DEBUG[${tag}]: compose state`, { inputs, ccLikeLinks: links });
}

// --- main loop -------------------------------------------------------------

function ruleMatches(rule, from) {
  if (!rule.enabled || !rule.cc) return false;
  if (!rule.from) return true; // empty `from` → applies to every compose
  return !!from && from === rule.from;
}

// Per-compose memory of which CCs WE auto-added. Lets us clean up after a
// rule whose CC has been edited / disabled / removed in settings.
function getAutoAdded(compose) {
  const raw = compose.dataset.autoCcAdded || "";
  return raw ? raw.split(",").filter(Boolean) : [];
}
function setAutoAdded(compose, ccs) {
  compose.dataset.autoCcAdded = ccs.join(",");
}

function tick() {
  for (const compose of findAllComposes()) {
    if (compose.offsetParent === null) continue; // hidden dialog (e.g. minimized draft)
    if (!findToInput(compose)) continue; // not a compose dialog

    // If this compose has no From row (single-account user), Gmail uses the
    // logged-in primary account as the sender — fall back to that.
    const from = findFromEmail(compose) || findPrimaryAccountEmail();

    // Build the target set from the current rules (lowercase → original casing).
    const targets = new Map();
    for (const rule of RULES) {
      if (ruleMatches(rule, from)) targets.set(rule.cc.toLowerCase(), rule.cc);
    }
    const targetKeys = new Set(targets.keys());

    // Anything WE added previously that is no longer a target → remove.
    const previouslyAdded = getAutoAdded(compose);
    const stillAdded = [];
    for (const cc of previouslyAdded) {
      const key = cc.toLowerCase();
      if (targetKeys.has(key)) {
        stillAdded.push(cc);
      } else {
        if (hasCc(compose, cc)) removeCc(compose, cc);
      }
    }

    // What we still need to add: every target not currently present.
    const toAdd = [];
    for (const [key, cc] of targets) {
      if (!hasCc(compose, cc)) toAdd.push(cc);
    }

    LOG("tick", {
      from,
      target: [...targets.values()],
      previouslyAdded,
      toAdd,
    });

    if (toAdd.length === 0) {
      setAutoAdded(compose, stillAdded);
      continue;
    }

    // Reveal the Cc field if needed (do it once per compose per tick).
    let ccInput = findCcInput(compose);
    if (!ccInput || ccInput.offsetParent === null) {
      const toggle = findCcToggle(compose);
      if (toggle) {
        LOG("revealing Cc field", {
          text: toggle.textContent.trim(),
          aria: toggle.getAttribute("aria-label"),
        });
        toggle.click();
      } else {
        LOG("no Cc input or toggle found");
        dumpComposeForDebug(compose, "no-toggle");
      }
      // Cc input will exist on the next tick.
      setAutoAdded(compose, stillAdded);
      continue;
    }

    // Write each missing target and remember we did so.
    for (const cc of toAdd) {
      if (writeCc(compose, cc)) stillAdded.push(cc);
    }
    setAutoAdded(compose, stillAdded);
  }
}

const observer = new MutationObserver(tick);
observer.observe(document.body, { childList: true, subtree: true });
setInterval(tick, 800);

// Manual debug helper — run `__gmailAutoCcDebug()` from the console to dump
// what the script sees in every visible compose right now.
window.__gmailAutoCcDebug = function () {
  LOG("=== manual debug ===");
  LOG("rules:", RULES);
  LOG("primary account:", findPrimaryAccountEmail());
  let n = 0;
  for (const compose of findAllComposes()) {
    if (compose.offsetParent === null) continue;
    if (!findToInput(compose)) continue;
    n++;
    LOG(`--- compose #${n} ---`);
    LOG("from row:", findFromEmail(compose));
    LOG("ccInput:", findCcInput(compose));
    LOG("ccToggle:", findCcToggle(compose));
    dumpComposeForDebug(compose, "manual");
  }
  if (!n) LOG("no visible compose with a To input found");
};

LOG("content script loaded (build v4 — multi-rule)");
