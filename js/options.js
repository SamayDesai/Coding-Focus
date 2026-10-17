(() => {
  const $ = (id) => document.getElementById(id);
  let state = null;
  let allowlistDraft = [];
  let allowlistDirty = false;

  function toast(message, error = false) {
    const el = $("toast"); el.textContent = message; el.className = `toast visible ${error ? "error" : "success"}`;
    setTimeout(() => { el.className = "toast"; }, 4500);
  }
  async function send(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw new Error(response?.error || "Action failed.");
    state = response.state || state; render(); return response;
  }
  function titleForSlug(slug) {
    const c = state?.collections?.find((x) => x.id === state.settings.activeCollectionId) || state?.collections?.[0];
    const p = c?.problems.find((x) => x.slug === slug) || state?.collections.flatMap((x) => x.problems).find((x) => x.slug === slug);
    return p ? LF.problemTitle(p) : slug || "None";
  }
  function appendText(parent, tag, text, className) {
    const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; parent.append(el); return el;
  }
  function renderCollections() {
    const container = $("collections"); container.replaceChildren();
    const select = $("activeCollection"); const old = select.value; select.replaceChildren();
    for (const collection of state.collections) {
      const option = document.createElement("option"); option.value = collection.id; option.textContent = `${collection.name} (${collection.problems.length})`; select.append(option);
      const row = document.createElement("div"); row.className = "list-row";
      const main = document.createElement("div"); main.className = "list-main";
      appendText(main, "strong", collection.name);
      appendText(main, "small", `${collection.problems.length} problems · ${collection.id === state.settings.activeCollectionId ? "Active collection" : "Available"}`);
      row.append(main);
      if (collection.id !== state.settings.activeCollectionId) {
        const activate = document.createElement("button"); activate.textContent = "Activate";
        activate.addEventListener("click", async () => { try { await send("SET_ACTIVE_COLLECTION", { id: collection.id }); toast(`Activated ${collection.name}. Today's assignment was updated.`); } catch (e) { toast(e.message, true); } });
        row.append(activate);
      } else {
        const active = document.createElement("span"); active.className = "status-pill success"; active.textContent = "Active"; row.append(active);
      }
      if (collection.id !== "starter") {
        const del = document.createElement("button"); del.className = "danger"; del.textContent = "Delete";
        del.addEventListener("click", async () => {
          if (!confirm(`Delete collection “${collection.name}”?`)) return;
          try { await send("DELETE_COLLECTION", { id: collection.id }); toast("Collection deleted."); } catch (e) { toast(e.message, true); }
        }); row.append(del);
      }
      container.append(row);
    }
    select.value = state.settings.activeCollectionId || old;
  }
  function renderAllowlist() {
    const groups = $("allowlistGroups"); groups.replaceChildren();
    const byLabel = new Map();
    for (const item of allowlistDraft) {
      const label = item.label || "Custom";
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(item);
    }
    const ordered = [...byLabel.entries()].sort((a, b) => {
      const weight = (label) => label === "Gmail" ? 0 : label === "Google Calendar" ? 1 : label === "Google Search" ? 2 : 3;
      return weight(a[0]) - weight(b[0]) || a[0].localeCompare(b[0]);
    });
    for (const [label, entries] of ordered) {
      const details = document.createElement("details"); details.className = "domain-section"; details.open = label !== "Google Search";
      const summary = document.createElement("summary"); summary.textContent = `${label} (${entries.length})`; details.append(summary);
      const list = document.createElement("div"); list.className = "domain-list"; list.style.marginTop = "10px";
      for (const item of entries) {
        const row = document.createElement("div"); row.className = "list-row";
        const input = document.createElement("input"); input.value = item.domain; input.setAttribute("aria-label", `Domain ${item.domain}`); input.style.minWidth = "0";
        input.addEventListener("input", () => { item.domain = input.value; allowlistDirty = true; });
        const subLabel = document.createElement("label"); subLabel.className = "inline"; subLabel.style.fontSize = "11px"; subLabel.style.whiteSpace = "nowrap";
        const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = item.includeSubdomains; checkbox.addEventListener("change", () => { item.includeSubdomains = checkbox.checked; allowlistDirty = true; });
        subLabel.append(checkbox, document.createTextNode("Subdomains"));
        const remove = document.createElement("button"); remove.className = "danger"; remove.textContent = "×"; remove.title = `Remove ${item.domain}`;
        remove.addEventListener("click", () => { allowlistDraft = allowlistDraft.filter((candidate) => candidate !== item); allowlistDirty = true; renderAllowlist(); });
        row.append(input, subLabel, remove); list.append(row);
      }
      details.append(list); groups.append(details);
    }
    if (!allowlistDraft.length) groups.innerHTML = '<div class="empty-state">No optional sites are allowlisted. LeetCode and extension pages remain available.</div>';
  }
  function render() {
    if (!state) return;
    $("dailyEnabled").checked = Boolean(state.settings.dailyEnabled);
    $("dailyProblem").value = state.daily ? titleForSlug(state.daily.slug) : "No assignment";
    $("bypassMinutes").value ||= 30;
    const remaining = state.bypassUntil ? Math.max(0, state.bypassUntil - Date.now()) : 0;
    $("bypassStatus").textContent = remaining ? `Blocking disabled for ${LF.formatDuration(remaining)} more (until ${new Date(state.bypassUntil).toLocaleString()}).` : "No active bypass.";
    document.documentElement.dataset.theme = state.settings.timer.theme || "system"; document.body.dataset.theme = state.settings.timer.theme || "system";
    document.documentElement.style.setProperty("--accent", state.settings.timer.accent || "#5b5bd6");
    renderCollections();
    renderAllowlist();
  }
  async function reload() {
    try { const response = await chrome.runtime.sendMessage({ type: "GET_STATE" }); if (response?.state) { state = response.state; if (!allowlistDirty) allowlistDraft = LF.clone(state.settings.allowlist || []); render(); } }
    catch (e) { toast(e.message, true); }
  }
  function parseImportText(text) {
    const trimmed = text.trim(); if (!trimmed) throw new Error("Paste a list or choose a file first.");
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try { return JSON.parse(trimmed); } catch { /* Try plain text/CSV below. */ }
    }
    return trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  $("problemFile").addEventListener("change", async () => {
    const file = $("problemFile").files?.[0]; if (!file) return;
    try { $("problemData").value = await file.text(); if (!$("collectionName").value) $("collectionName").value = file.name.replace(/\.[^.]+$/, ""); }
    catch (e) { toast(`Could not read file: ${e.message}`, true); }
  });
  $("importCollection").addEventListener("click", async () => {
    try {
      const payload = parseImportText($("problemData").value);
      const response = await send("IMPORT_COLLECTION", { name: $("collectionName").value || "Imported List", payload, activate: true });
      $("problemData").value = ""; $("problemFile").value = "";
      toast(`Imported ${response.count} problems and activated the collection.`);
    } catch (e) { toast(e.message, true); }
  });
  $("activeCollection").addEventListener("change", async () => {
    try { await send("SET_ACTIVE_COLLECTION", { id: $("activeCollection").value }); toast("Active collection changed; today's assignment was updated."); }
    catch (e) { toast(e.message, true); }
  });
  $("dailyEnabled").addEventListener("change", async () => {
    try { await send("SET_DAILY_ENABLED", { enabled: $("dailyEnabled").checked }); toast($("dailyEnabled").checked ? "Daily enforcement enabled." : "Daily enforcement disabled."); }
    catch (e) { toast(e.message, true); }
  });
  $("addDomain").addEventListener("click", () => {
    try {
      const domain = LF.normalizeDomain($("newDomain").value);
      if (domain === "leetcode.com" || domain.endsWith(".leetcode.com")) throw new Error("LeetCode is always allowed and does not need to be added.");
      const includeSubdomains = $("newIncludeSubdomains").checked;
      if (allowlistDraft.some((item) => item.domain === domain && item.includeSubdomains === includeSubdomains)) throw new Error("That domain is already in the allowlist.");
      allowlistDraft.push({ domain, includeSubdomains, label: "Custom" }); allowlistDirty = true; $("newDomain").value = ""; renderAllowlist();
    } catch (e) { toast(e.message, true); }
  });
  $("newDomain").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); $("addDomain").click(); } });
  $("saveAllowlist").addEventListener("click", async () => {
    try {
      const normalized = allowlistDraft.map((item) => ({ ...item, domain: LF.normalizeDomain(item.domain) }));
      const response = await send("SAVE_ALLOWLIST", { allowlist: normalized });
      allowlistDraft = LF.clone(state.settings.allowlist); allowlistDirty = false; renderAllowlist();
      toast(`Saved ${response.saved} allowlist entries. Changes apply immediately.`);
    } catch (e) { toast(e.message, true); }
  });
  $("resetAllowlist").addEventListener("click", () => { allowlistDraft = LF.clone(LF.defaultAllowlist); allowlistDirty = true; renderAllowlist(); toast("Defaults loaded. Click Save allowlist to apply them."); });
  $("startBypass").addEventListener("click", async () => { try { const minutes = Number($("bypassMinutes").value); await send("SET_BYPASS", { minutes }); toast(`Blocking disabled for ${minutes} minutes.`); } catch (e) { toast(e.message, true); } });
  $("clearBypass").addEventListener("click", async () => { try { await send("CLEAR_BYPASS"); toast("Temporary disable ended."); } catch (e) { toast(e.message, true); } });
  $("openTimer").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }));
  $("openTimer2").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }));
  $("resetTimerData").addEventListener("click", async () => { try { await send("RESET_TIMER"); toast("Timer session reset. Settings and history were kept."); } catch (e) { toast(e.message, true); } });
  $("exportBackup").addEventListener("click", async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "EXPORT_STATE" });
      if (!response?.ok) throw new Error(response.error || "Could not create backup.");
      const blob = new Blob([JSON.stringify(response.exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `leetcode-focus-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); toast("Backup exported.");
    } catch (e) { toast(e.message, true); }
  });
  $("restoreBackup").addEventListener("click", () => $("backupFile").click());
  $("backupFile").addEventListener("change", async () => {
    const file = $("backupFile").files?.[0]; if (!file) return;
    try { const data = JSON.parse(await file.text()); await send("RESTORE_STATE", { data }); allowlistDraft = LF.clone(state.settings.allowlist || []); allowlistDirty = false; toast("Backup restored."); }
    catch (e) { toast(`Could not restore backup: ${e.message}`, true); }
    $("backupFile").value = "";
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.appState) reload(); });
  reload();
})();
