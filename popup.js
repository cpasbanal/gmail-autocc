const summary = document.getElementById("summary");

chrome.storage.sync.get(["rules", "cc", "matchFrom"], (data) => {
  let rules = Array.isArray(data.rules) ? data.rules : null;
  // Fall back to legacy single-pair format if no rules array exists yet.
  if (!rules && data.cc) {
    rules = [{ from: data.matchFrom || "", cc: data.cc, enabled: true }];
  }
  rules = rules || [];
  const total = rules.length;
  const active = rules.filter((r) => r.enabled !== false && r.cc).length;
  if (total === 0) {
    summary.textContent = "No rules configured yet.";
  } else {
    summary.textContent = `${active} active rule${active === 1 ? "" : "s"}` +
      (total !== active ? ` (${total - active} disabled)` : "");
  }
});

document.getElementById("open").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
