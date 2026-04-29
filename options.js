// Options page logic.
//
// Storage shape:
//   chrome.storage.sync.rules = [{ from: string, cc: string, enabled: bool }]
//
// On first load, migrate any legacy { matchFrom, cc } pair into a one-item
// rules array.

const rowsEl = document.getElementById("rows");
const addBtn = document.getElementById("add");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");

// In-memory working copy of the rule list.
let rules = [];

function render() {
  rowsEl.innerHTML = "";
  if (rules.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "empty";
    td.textContent = 'No rules yet. Click "+ Add rule" to create one.';
    tr.appendChild(td);
    rowsEl.appendChild(tr);
    return;
  }
  for (let i = 0; i < rules.length; i++) {
    rowsEl.appendChild(makeRow(rules[i], i));
  }
}

function makeRow(rule, index) {
  const tr = document.createElement("tr");

  // Toggle
  const toggleCell = document.createElement("td");
  const label = document.createElement("label");
  label.className = "switch";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = rule.enabled !== false;
  cb.addEventListener("change", () => {
    rules[index].enabled = cb.checked;
  });
  const slider = document.createElement("span");
  slider.className = "slider";
  label.appendChild(cb);
  label.appendChild(slider);
  toggleCell.appendChild(label);
  tr.appendChild(toggleCell);

  // From
  const fromCell = document.createElement("td");
  const fromIn = document.createElement("input");
  fromIn.type = "email";
  fromIn.placeholder = "you@example.com (blank = any)";
  fromIn.value = rule.from || "";
  fromIn.addEventListener("input", () => {
    rules[index].from = fromIn.value.trim();
  });
  fromCell.appendChild(fromIn);
  tr.appendChild(fromCell);

  // CC
  const ccCell = document.createElement("td");
  const ccIn = document.createElement("input");
  ccIn.type = "email";
  ccIn.placeholder = "cc@example.com";
  ccIn.value = rule.cc || "";
  ccIn.addEventListener("input", () => {
    rules[index].cc = ccIn.value.trim();
  });
  ccCell.appendChild(ccIn);
  tr.appendChild(ccCell);

  // Remove
  const actionsCell = document.createElement("td");
  actionsCell.className = "col-actions";
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "remove-btn";
  rm.title = "Remove this rule";
  rm.textContent = "✕";
  rm.addEventListener("click", () => {
    rules.splice(index, 1);
    render();
  });
  actionsCell.appendChild(rm);
  tr.appendChild(actionsCell);

  return tr;
}

function addRule() {
  rules.push({ from: "", cc: "", enabled: true });
  render();
  // focus the "From" input of the newly added row
  const newRow = rowsEl.lastElementChild;
  const firstInput = newRow && newRow.querySelector('input[type="email"]');
  if (firstInput) firstInput.focus();
}

function save() {
  // Drop incomplete rules (empty cc) silently — they would never fire anyway.
  // Also normalize whitespace.
  const cleaned = rules
    .map((r) => ({
      from: (r.from || "").trim(),
      cc: (r.cc || "").trim(),
      enabled: r.enabled !== false,
    }))
    .filter((r) => r.cc);

  saveBtn.disabled = true;
  chrome.storage.sync.set({ rules: cleaned }, () => {
    // Also clear the legacy keys so the migration path doesn't re-apply.
    chrome.storage.sync.remove(["matchFrom", "cc"], () => {
      saveBtn.disabled = false;
      statusEl.textContent = "Saved";
      setTimeout(() => (statusEl.textContent = ""), 1800);
      // Reflect any drops/normalization back into the in-memory copy
      rules = cleaned;
      render();
    });
  });
}

addBtn.addEventListener("click", addRule);
saveBtn.addEventListener("click", save);

// Initial load
chrome.storage.sync.get(["rules", "cc", "matchFrom"], (data) => {
  if (Array.isArray(data.rules)) {
    rules = data.rules.map((r) => ({
      from: (r.from || "").trim(),
      cc: (r.cc || "").trim(),
      enabled: r.enabled !== false,
    }));
  } else if (data.cc) {
    // Migrate legacy single pair.
    rules = [
      {
        from: (data.matchFrom || "").trim(),
        cc: (data.cc || "").trim(),
        enabled: true,
      },
    ];
  } else {
    rules = [];
  }
  render();
});
