(() => {
  const $ = (id) => document.getElementById(id);
  let state = null; let status = null;
  async function send(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw new Error(response?.error || "Action failed.");
    state = response.state || state; status = response.status || status; render(); return response;
  }
  function render() {
    if (!state) return;
    const collection = state.collections.find((c) => c.id === state.daily?.collectionId) || state.collections[0];
    const problem = collection?.problems.find((p) => p.slug === state.daily?.slug);
    const timer = state.timer;
    const focus = status?.timerFocus;
    const daily = status?.dailyGate;
    $("blockedHeading").textContent = status?.bypassActive ? "Temporary disable is active." : "This site is blocked right now.";
    $("blockedDescription").textContent = status?.bypassActive ? "Blocking should be disabled until the timer expires. If you still see this page, reload the site." : focus && daily ? "Your daily requirement is unfinished, and a focus timer is running. Complete today's problem to clear the daily gate, and end focus mode or wait for a break to clear the timer gate." : daily ? "Solve the exact problem assigned for today. Once LeetCode reports Accepted, normal browsing is unlocked for the rest of the day." : focus ? "A focus phase is running. Your allowlisted sites and LeetCode remain available until the timer reaches a break." : "Your active policy blocks ordinary websites outside your allowlist.";
    $("requiredTitle").textContent = problem ? LF.problemTitle(problem) : "No daily assignment";
    $("requiredDescription").textContent = !state.settings.dailyEnabled ? "Daily enforcement is disabled. The focus timer may still be blocking this site." : state.daily?.complete ? "Today's daily requirement is complete." : "Today's exact assigned problem must be Accepted to clear the daily gate.";
    $("openRequired").disabled = !problem || state.daily?.complete;
    $("openRequired").style.display = state.settings.dailyEnabled && !state.daily?.complete ? "inline-block" : "none";
    $("lockReason").textContent = status?.dailyGate ? "Daily gate" : status?.timerFocus ? `Focus · ${timer.phase}` : status?.bypassActive ? "Bypass active" : "Blocked";
    $("bypassInfo").textContent = status?.bypassActive ? `Blocking is disabled until ${new Date(status.bypassUntil).toLocaleTimeString()}.` : "The original policy will resume automatically when the timer expires.";
    document.documentElement.dataset.theme = state.settings.timer.theme || "system"; document.body.dataset.theme = state.settings.timer.theme || "system";
    document.documentElement.style.setProperty("--accent", state.settings.timer.accent || "#5b5bd6");
  }
  async function load() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATE" }); state = response.state; status = response.status; render();
      const target = await chrome.runtime.sendMessage({ type: "GET_BLOCKED_TARGET" });
      if (target?.originalUrl) {
        try {
          const url = new URL(target.originalUrl);
          let note = document.getElementById("attemptNote");
          if (!note) { note = document.createElement("p"); note.id = "attemptNote"; note.className = "field-hint"; $("blockedDescription").after(note); }
          note.textContent = `Attempted site: ${url.hostname}`;
        } catch (_) {}
      }
    } catch (e) { $("blockedDescription").textContent = e.message; }
  }
  $("openRequired").addEventListener("click", () => { if (state?.daily?.slug) chrome.tabs.create({ url: LF.problemUrl(state.daily.slug) }); });
  $("openTimer").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }));
  $("openSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("openLeetCode").addEventListener("click", () => chrome.tabs.create({ url: state?.daily?.slug ? LF.problemUrl(state.daily.slug) : "https://leetcode.com/problemset/" }));
  $("bypass").addEventListener("click", async () => { try { await send("SET_BYPASS", { minutes: Number($("bypassMinutes").value) }); toastButton(); } catch (e) { $("bypassInfo").textContent = e.message; } });
  function toastButton() { $("bypassInfo").textContent = `Temporary disable started for ${$("bypassMinutes").value} minutes.`; }
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.appState) load(); });
  load();
})();
