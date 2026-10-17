(() => {
  const $ = (id) => document.getElementById(id);
  let appState = null;
  let status = null;
  let audioContext = null;
  let noiseSource = null;
  let noiseGain = null;
  let lastPhaseKey = "";
  let lastRenderedSettings = "";
  const phaseLabels = { implementation: "Implementation", review: "Solution review", shortBreak: "Short break", longBreak: "Long break" };

  function toast(message, error = false) {
    const el = $("toast"); el.textContent = message; el.className = `toast visible ${error ? "error" : "success"}`;
    setTimeout(() => { el.className = "toast"; }, 3500);
  }
  async function send(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw new Error(response?.error || "Action failed.");
    appState = response.state || appState; status = response.status || status; render(); return response;
  }
  function remaining() {
    const t = appState?.timer; if (!t) return 0;
    return t.status === "running" && t.phaseEndAt ? Math.max(0, t.phaseEndAt - Date.now()) : Math.max(0, t.remainingMs || 0);
  }
  function timerSettings() { return appState?.settings?.timer || {}; }
  function prettyMinutes(ms) {
    const minutes = Math.floor(ms / 60000); const seconds = Math.floor((ms % 60000) / 1000);
    if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
    if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
    return `${seconds}s`;
  }
  function showSettings(settings) {
    const hash = JSON.stringify(settings);
    if (hash === lastRenderedSettings) return;
    lastRenderedSettings = hash;
    for (const id of ["implementationMinutes", "reviewMinutes", "shortBreakMinutes", "longBreakMinutes", "roundsPerSession", "theme", "accent"]) $(id).value = settings[id];
    for (const id of ["autoStartFocus", "autoStartBreak", "notifications", "sound", "whiteNoise"]) $(id).checked = Boolean(settings[id]);
  }
  function renderStats(t) {
    const entries = Object.entries(t.focusMsByTask || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { $("taskStats").innerHTML = '<div class="empty-state">Start a focus phase to build your statistics.</div>'; return; }
    const table = document.createElement("table"); table.className = "table";
    const thead = document.createElement("thead"); thead.innerHTML = "<tr><th>Task</th><th>Focus time</th><th>Share</th></tr>"; table.append(thead);
    const tbody = document.createElement("tbody");
    for (const [name, ms] of entries) {
      const row = document.createElement("tr");
      const taskCell = document.createElement("td"); taskCell.textContent = name;
      const timeCell = document.createElement("td"); timeCell.textContent = prettyMinutes(ms);
      const shareCell = document.createElement("td"); shareCell.textContent = `${Math.round(ms / Math.max(1, t.totalFocusMs) * 100)}%`;
      row.append(taskCell, timeCell, shareCell); tbody.append(row);
    }
    table.append(tbody); $("taskStats").replaceChildren(table);
  }
  function render() {
    if (!appState) return;
    const t = appState.timer; const settings = timerSettings(); const ms = remaining();
    document.documentElement.dataset.theme = settings.theme || "system"; document.body.dataset.theme = settings.theme || "system";
    document.documentElement.style.setProperty("--accent", settings.accent || "#5b5bd6");
    $("phaseEyebrow").textContent = t.status === "running" ? "SESSION IN PROGRESS" : t.status === "paused" ? "SESSION PAUSED" : "READY TO FOCUS";
    $("phaseTitle").textContent = phaseLabels[t.phase] || "Implementation";
    $("timerStatus").textContent = t.status === "running" ? "Running" : t.status === "paused" ? "Paused" : "Idle";
    $("timerStatus").className = `status-pill ${t.status === "running" ? "success" : ""}`;
    $("bigTime").textContent = LF.formatDuration(ms);
    const totalPhaseMs = t.status === "running" && t.phaseEndAt && t.phaseStartedAt ? Math.max(1, t.phaseEndAt - t.phaseStartedAt) : Math.max(1, ms || 1);
    $("progressBar").style.width = `${Math.min(100, Math.max(0, (1 - ms / totalPhaseMs) * 100))}%`;
    $("timeRemainingLabel").textContent = `${prettyMinutes(ms)} remaining`;
    $("roundProgress").textContent = `${t.roundsCompleted || 0} / ${settings.roundsPerSession} problems`;
    $("startPause").textContent = t.status === "running" ? "Pause" : t.status === "paused" ? "Resume" : "Start focus";
    $("skipBreak").disabled = t.status === "idle" || !["shortBreak", "longBreak"].includes(t.phase);
    $("skipPhase").disabled = t.status === "idle";
    $("cyclesDone").textContent = t.roundsCompleted || 0;
    $("cyclesGoal").textContent = settings.roundsPerSession;
    $("totalFocus").textContent = prettyMinutes(t.totalFocusMs || 0);
    $("sessionStatus").textContent = t.status === "running" ? "Active" : t.status === "paused" ? "Paused" : "Not started";
    $("blockingStatus").textContent = status?.dailyGate ? "Daily requirement is still locking non-allowlisted sites." : status?.timerFocus ? "Focus phase is locking non-allowlisted sites." : status?.bypassActive ? "Blocking is temporarily disabled." : "No current block from the daily gate or timer.";
    const task = t.currentTask || "";
    if (document.activeElement !== $("taskLabel")) $("taskLabel").value = task;
    showSettings(settings);
    renderStats(t);
    const phaseKey = `${t.phase}:${t.status}`;
    if (lastPhaseKey && phaseKey !== lastPhaseKey && settings.sound) playBeep();
    lastPhaseKey = phaseKey;
    syncWhiteNoise(settings, t);
  }
  async function reload() {
    try { const response = await chrome.runtime.sendMessage({ type: "GET_STATE" }); appState = response.state; status = response.status; render(); }
    catch (e) { toast(e.message, true); }
  }
  function playBeep() {
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const osc = context.createOscillator(); const gain = context.createGain();
      osc.type = "sine"; osc.frequency.value = 880; gain.gain.value = 0.045;
      osc.connect(gain); gain.connect(context.destination); osc.start(); osc.stop(context.currentTime + 0.12);
      osc.onended = () => context.close();
    } catch (_) {}
  }
  function stopWhiteNoise() {
    try { noiseGain?.gain.setTargetAtTime(0, audioContext.currentTime, 0.08); setTimeout(() => { try { noiseSource?.stop(); } catch (_) {} noiseSource = null; }, 350); } catch (_) {}
  }
  function startWhiteNoise() {
    try {
      if (noiseSource || !audioContext) return;
      const length = audioContext.sampleRate * 2; const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate); const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      noiseSource = audioContext.createBufferSource(); noiseSource.buffer = buffer; noiseSource.loop = true;
      noiseGain = audioContext.createGain(); noiseGain.gain.value = 0.04;
      noiseSource.connect(noiseGain); noiseGain.connect(audioContext.destination); noiseSource.start();
    } catch (_) {}
  }
  function syncWhiteNoise(settings, t) {
    const active = settings.whiteNoise && t.status === "running" && ["implementation", "review"].includes(t.phase);
    if (active) { if (audioContext?.state === "suspended") audioContext.resume().catch(() => {}); startWhiteNoise(); }
    else if (noiseSource) stopWhiteNoise();
  }

  $("startPause").addEventListener("click", async () => {
    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") await audioContext.resume();
      await send(appState.timer.status === "running" ? "PAUSE_TIMER" : "START_TIMER");
    } catch (e) { toast(e.message, true); }
  });
  $("skipPhase").addEventListener("click", async () => { try { await send("SKIP_PHASE"); } catch (e) { toast(e.message, true); } });
  $("skipBreak").addEventListener("click", async () => { try { await send("SKIP_BREAK"); } catch (e) { toast(e.message, true); } });
  $("resetTimer").addEventListener("click", async () => { try { await send("RESET_TIMER"); toast("Timer reset."); } catch (e) { toast(e.message, true); } });
  $("taskLabel").addEventListener("change", async () => { try { await send("SET_TASK", { task: $("taskLabel").value }); } catch (e) { toast(e.message, true); } });
  $("openSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("manageLists").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("backToPopup").addEventListener("click", () => toast("Use the LeetCode Focus extension icon in Chrome's toolbar for the quick popup."));
  $("openRequired").addEventListener("click", () => { if (appState.daily?.slug) chrome.tabs.create({ url: LF.problemUrl(appState.daily.slug) }); });
  $("saveSettings").addEventListener("click", async () => {
    try {
      const settings = {};
      for (const key of ["implementationMinutes", "reviewMinutes", "shortBreakMinutes", "longBreakMinutes", "roundsPerSession"]) settings[key] = Number($(key).value);
      for (const key of ["autoStartFocus", "autoStartBreak", "notifications", "sound", "whiteNoise"]) settings[key] = $(key).checked;
      settings.theme = $("theme").value; settings.accent = $("accent").value;
      await send("UPDATE_TIMER_SETTINGS", { settings }); toast("Timer settings saved.");
      if (audioContext && settings.whiteNoise && audioContext.state === "suspended") audioContext.resume().catch(() => {});
    } catch (e) { toast(e.message, true); }
  });

  async function openPiP() {
    try {
      if (!("documentPictureInPicture" in window)) {
        toast("Document Picture-in-Picture is not available in this Chrome version. Update desktop Chrome and try again.", true); return;
      }
      const pipWindow = await documentPictureInPicture.requestWindow({ width: 330, height: 225 });
      pipWindow.document.title = "LeetCode Focus Timer";
      const style = pipWindow.document.createElement("style");
      style.textContent = `*{box-sizing:border-box}body{margin:0;padding:15px;background:${getComputedStyle(document.body).getPropertyValue('--panel')};color:${getComputedStyle(document.body).getPropertyValue('--text')};font:13px system-ui,-apple-system,sans-serif}body{background:#171923;color:#f5f6fa}.phase{font-size:10px;font-weight:750;letter-spacing:.12em;text-transform:uppercase;color:#a5a6c8}.time{font-variant-numeric:tabular-nums;font-size:44px;font-weight:780;letter-spacing:-.065em;margin:6px 0 8px;line-height:1}.sub{font-size:11px;color:#b7bbca;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.track{height:4px;background:#343747;border-radius:99px;overflow:hidden;margin:10px 0 12px}.bar{height:100%;background:#9696ff;width:0%}.buttons{display:flex;gap:6px}.buttons button{flex:1;border:1px solid #414456;border-radius:8px;background:#252938;color:white;padding:8px 4px;font-weight:650;font-size:11px;cursor:pointer}.buttons button.primary{background:#8585f5;border-color:#8585f5;color:#11121b}`;
      pipWindow.document.head.append(style);
      const root = pipWindow.document.createElement("div");
      root.innerHTML = '<div id="pipPhase" class="phase">Implementation</div><div id="pipTime" class="time">30:00</div><div id="pipTask" class="sub">Problem 1 of 10</div><div class="track"><div id="pipBar" class="bar"></div></div><div class="buttons"><button id="pipToggle" class="primary">Pause</button><button id="pipSkip">Skip</button><button id="pipFull">Open</button></div>';
      pipWindow.document.body.append(root);
      const pip$ = (id) => pipWindow.document.getElementById(id);
      function drawPip() {
        if (!appState) return;
        const t = appState.timer; const ms = remaining();
        pip$("pipPhase").textContent = `${t.status === "paused" ? "Paused · " : ""}${phaseLabels[t.phase] || t.phase}`;
        pip$("pipTime").textContent = LF.formatDuration(ms);
        pip$("pipTask").textContent = `${t.currentTask || "LeetCode Focus"} · Problem ${(t.roundsCompleted || 0) + 1} / ${appState.settings.timer.roundsPerSession}`;
        const total = t.phaseStartedAt && t.phaseEndAt ? Math.max(1, t.phaseEndAt - t.phaseStartedAt) : Math.max(1, ms);
        pip$("pipBar").style.width = `${Math.max(0, Math.min(100, (1 - ms / total) * 100))}%`;
        pip$("pipToggle").textContent = t.status === "running" ? "Pause" : t.status === "paused" ? "Resume" : "Start";
      }
      pip$("pipToggle").addEventListener("click", async () => { try { await send(appState.timer.status === "running" ? "PAUSE_TIMER" : "START_TIMER"); drawPip(); } catch (e) { toast(e.message, true); } });
      pip$("pipSkip").addEventListener("click", async () => { try { await send(["shortBreak", "longBreak"].includes(appState.timer.phase) ? "SKIP_BREAK" : "SKIP_PHASE"); drawPip(); } catch (e) { toast(e.message, true); } });
      pip$("pipFull").addEventListener("click", () => window.focus());
      const pipInterval = setInterval(drawPip, 250);
      pipWindow.addEventListener("pagehide", () => clearInterval(pipInterval));
      drawPip();
    } catch (error) { toast(error.message || "Could not open Picture-in-Picture.", true); }
  }
  $("openPip").addEventListener("click", openPiP);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.appState) reload(); });
  reload();
  setInterval(() => { if (appState) { $("bigTime").textContent = LF.formatDuration(remaining()); } }, 250);
  window.addEventListener("beforeunload", stopWhiteNoise);
})();
