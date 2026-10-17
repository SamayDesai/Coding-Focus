(() => {
  const $ = (id) => document.getElementById(id);
  let appState = null;
  let uiStatus = null;
  let paintTimer = null;
  const phaseLabels = { implementation: "Implementation", review: "Solution review", shortBreak: "Short break", longBreak: "Long break" };

  function toast(message, error = false) {
    const el = $("toast");
    el.textContent = message;
    el.className = `toast visible ${error ? "error" : "success"}`;
    setTimeout(() => { el.className = "toast"; }, 3500);
  }

  async function send(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw new Error(response?.error || "The extension could not complete that action.");
    appState = response.state || appState;
    uiStatus = response.status || uiStatus;
    render();
    return response;
  }

  function activeCollection() { return appState?.collections?.find((c) => c.id === appState.settings.activeCollectionId) || appState?.collections?.[0]; }
  function findProblem(slug, collectionId) {
    const collection = appState?.collections?.find((c) => c.id === collectionId) || activeCollection();
    return collection?.problems?.find((p) => p.slug === slug) || null;
  }
  function timerRemaining() {
    const t = appState?.timer;
    if (!t) return 0;
    if (t.status === "running" && t.phaseEndAt) return Math.max(0, t.phaseEndAt - Date.now());
    return Math.max(0, t.remainingMs || 0);
  }
  function render() {
    if (!appState) return;
    const daily = appState.daily;
    const required = findProblem(daily?.slug, daily?.collectionId);
    const suggestion = findProblem(appState.nextSuggestionSlug);
    const locked = Boolean(uiStatus?.locked);
    const dailyPending = Boolean(appState.settings.dailyEnabled && daily && !daily.complete && !uiStatus?.bypassActive);
    $("statusLine").textContent = locked ? (uiStatus?.dailyGate ? "Daily requirement active" : "Focus blocking active") : "Browsing available";
    $("dailyPill").textContent = !appState.settings.dailyEnabled ? "Disabled" : daily?.complete ? "Complete" : "Required";
    $("dailyPill").className = `status-pill ${daily?.complete || !appState.settings.dailyEnabled ? "success" : "locked"}`;
    $("dailyTitle").textContent = required ? LF.problemTitle(required) : "No problem assigned";
    $("dailyHint").textContent = !appState.settings.dailyEnabled ? "Daily enforcement is disabled in settings." : daily?.complete ? "Done for today. Browsing is unlocked unless focus mode is active." : "Solve this exact problem and get an Accepted result to unlock browsing for the rest of the day.";
    $("openDaily").disabled = !required;
    $("markDailyDone").style.display = dailyPending ? "inline-block" : "none";
    $("nextTitle").textContent = suggestion ? LF.problemTitle(suggestion) : "Collection exhausted";
    $("openNext").disabled = !suggestion;
    const timer = appState.timer;
    $("timerTime").textContent = LF.formatDuration(timerRemaining());
    const running = timer.status === "running";
    const idle = timer.status === "idle";
    $("timerPill").textContent = running ? "Running" : idle ? "Idle" : "Paused";
    $("timerPill").className = `status-pill ${running ? "success" : ""}`;
    $("timerPhase").textContent = `${phaseLabels[timer.phase] || timer.phase} · ${timer.roundsCompleted || 0} / ${appState.settings.timer.roundsPerSession} problems completed`;
    $("toggleTimer").textContent = running ? "Pause" : idle ? "Start focus" : "Resume";
    $("skipTimer").textContent = timer.phase === "shortBreak" || timer.phase === "longBreak" ? "Skip break" : "Skip phase";
    $("skipTimer").disabled = idle;
    $("bypassRemaining").textContent = uiStatus?.bypassActive ? `Until ${new Date(uiStatus.bypassUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "";
    $("endBypass").disabled = !uiStatus?.bypassActive;
    $("lockExplanation").textContent = uiStatus?.dailyGate ? "Complete the required problem. Your allowlist remains accessible." : uiStatus?.timerFocus ? "Focus phase is blocking sites outside your allowlist." : uiStatus?.bypassActive ? "Blocking is temporarily disabled." : "Your allowlist is available; other sites may be blocked by active focus sessions.";
    document.documentElement.dataset.theme = appState.settings.timer.theme || "system"; document.body.dataset.theme = appState.settings.timer.theme || "system";
    document.documentElement.style.setProperty("--accent", appState.settings.timer.accent || "#5b5bd6");
  }

  function openProblem(slug) { if (slug) chrome.tabs.create({ url: LF.problemUrl(slug) }); }
  function showError(error) { toast(error?.message || String(error), true); }

  $("openDaily").addEventListener("click", () => openProblem(appState?.daily?.slug));
  $("openNext").addEventListener("click", () => openProblem(appState?.nextSuggestionSlug));
  $("markDailyDone").addEventListener("click", async () => {
    const slug = appState?.daily?.slug;
    if (!slug) return;
    try {
      const tabs = await chrome.tabs.query({ url: ["https://leetcode.com/problems/*", "https://www.leetcode.com/problems/*"] });
      const found = tabs.find((tab) => tab.url?.includes(`/problems/${slug}/`));
      if (!found?.id) throw new Error("Open today's assigned problem in a LeetCode tab first.");
      const response = await chrome.tabs.sendMessage(found.id, { type: "RECHECK_ACCEPTED" });
      if (!response?.ok) throw new Error(response?.error || "No Accepted result could be confirmed.");
      await refresh();
      toast("LeetCode's visible Accepted result was rechecked.");
    } catch (error) { showError(error); }
  });
  $("refreshSuggestion").addEventListener("click", async () => {
    try {
      // Rotate suggestion using an existing collection item. This never changes today's assignment.
      const collection = activeCollection();
      const seen = new Set([appState.daily?.slug]);
      (appState.seenByCollection?.[collection.id] || []).forEach((slug) => seen.add(slug));
      let options = collection.problems.filter((p) => !seen.has(p.slug));
      if (!options.length) options = collection.problems.filter((p) => p.slug !== appState.daily?.slug);
      const pick = options[Math.floor(Math.random() * options.length)];
      if (pick) await send("SET_NEXT_SUGGESTION", { slug: pick.slug });
    } catch (error) { showError(error); }
  });
  $("toggleTimer").addEventListener("click", async () => {
    try { await send(appState?.timer?.status === "running" ? "PAUSE_TIMER" : "START_TIMER"); }
    catch (error) { showError(error); }
  });
  $("skipTimer").addEventListener("click", async () => {
    try { await send(appState?.timer?.phase === "shortBreak" || appState?.timer?.phase === "longBreak" ? "SKIP_BREAK" : "SKIP_PHASE"); }
    catch (error) { showError(error); }
  });
  $("openTimer").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }));
  $("openSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("bypassPreset").addEventListener("change", () => { $("customBypass").style.display = $("bypassPreset").value === "custom" ? "block" : "none"; });
  $("startBypass").addEventListener("click", async () => {
    try {
      const minutes = $("bypassPreset").value === "custom" ? Number($("customBypass").value) : Number($("bypassPreset").value);
      await send("SET_BYPASS", { minutes });
      toast(`Blocking disabled for ${minutes} minutes.`);
    } catch (error) { showError(error); }
  });
  $("endBypass").addEventListener("click", async () => { try { await send("CLEAR_BYPASS"); toast("Temporary disable ended."); } catch (error) { showError(error); } });

  async function refresh() { try { const response = await send("GET_STATE"); appState = response.state; uiStatus = response.status; render(); } catch (error) { showError(error); } }
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.appState) refresh(); });
  refresh();
  paintTimer = setInterval(() => { if (appState) { $("timerTime").textContent = LF.formatDuration(timerRemaining()); } }, 250);
  window.addEventListener("unload", () => clearInterval(paintTimer));
})();
