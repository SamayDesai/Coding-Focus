importScripts("shared.js");

const STATE_KEY = "appState";
const RULE_BLOCK_ID = 1;
const RULE_LEETCODE_ID = 2;
const RULE_ALLOW_BASE = 100;
let operationQueue = Promise.resolve();

function activeCollection(state) {
  return state.collections.find((c) => c.id === state.settings.activeCollectionId) || state.collections[0];
}

function currentProblem(collection, slug) {
  return collection?.problems?.find((p) => p.slug === slug) || null;
}

function randomItem(items) {
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}

function seenList(state, collectionId) {
  if (!state.seenByCollection[collectionId]) state.seenByCollection[collectionId] = [];
  return state.seenByCollection[collectionId];
}

function solvedList(state, collectionId) {
  if (!state.solvedSlugsByCollection[collectionId]) state.solvedSlugsByCollection[collectionId] = [];
  return state.solvedSlugsByCollection[collectionId];
}

function chooseUnseen(state, collection, excluded = []) {
  if (!collection || !collection.problems?.length) return null;
  let seen = seenList(state, collection.id);
  const blocked = new Set([...seen, ...excluded]);
  let candidates = collection.problems.filter((p) => !blocked.has(p.slug));
  if (!candidates.length) {
    // A collection is allowed to repeat only after every problem has been visited.
    state.seenByCollection[collection.id] = [];
    seen = state.seenByCollection[collection.id];
    candidates = collection.problems.filter((p) => !excluded.includes(p.slug));
  }
  return randomItem(candidates.length ? candidates : collection.problems);
}

function assignDaily(state, dateKey = LF.localDateKey()) {
  const collection = activeCollection(state);
  if (!collection || !collection.problems?.length) return;
  const previousSlug = state.daily?.slug;
  const assigned = chooseUnseen(state, collection, []);
  if (!assigned) return;
  const seen = seenList(state, collection.id);
  if (!seen.includes(assigned.slug)) seen.push(assigned.slug);
  state.daily = {
    date: dateKey,
    slug: assigned.slug,
    collectionId: collection.id,
    complete: false,
    assignedAt: Date.now(),
    previousSlug: previousSlug || null
  };
  if (!state.nextSuggestionSlug || state.nextSuggestionSlug === assigned.slug) {
    const next = chooseUnseen(state, collection, [assigned.slug]);
    state.nextSuggestionSlug = next?.slug || null;
  }
}

function ensureDaily(state, now = Date.now()) {
  const dateKey = LF.localDateKey(new Date(now));
  let changed = false;
  if (!state.daily || state.daily.date !== dateKey || !currentProblem(activeCollection(state), state.daily.slug) || state.daily.collectionId !== activeCollection(state)?.id) {
    assignDaily(state, dateKey);
    changed = true;
  }
  if (state.bypassUntil && state.bypassUntil <= now) {
    state.bypassUntil = null;
    changed = true;
  }
  const collection = activeCollection(state);
  if (!state.nextSuggestionSlug || !currentProblem(collection, state.nextSuggestionSlug) || state.nextSuggestionSlug === state.daily?.slug) {
    const next = chooseUnseen(state, collection, [state.daily?.slug].filter(Boolean));
    state.nextSuggestionSlug = next?.slug || null;
    changed = true;
  }
  return changed;
}

function effectiveStatus(state, now = Date.now()) {
  const bypassActive = Boolean(state.bypassUntil && state.bypassUntil > now);
  const dailyGate = Boolean(state.settings.dailyEnabled && state.daily && !state.daily.complete);
  // Pausing work must not become a one-click way to disable the focus blocker.
  const timerFocus = Boolean(state.timer.status !== "idle" && (state.timer.phase === "implementation" || state.timer.phase === "review"));
  return {
    locked: !bypassActive && (dailyGate || timerFocus),
    dailyGate: dailyGate && !bypassActive,
    timerFocus: timerFocus && !bypassActive,
    bypassActive,
    bypassUntil: state.bypassUntil || null,
    dailyComplete: Boolean(state.daily?.complete),
    date: state.daily?.date || LF.localDateKey()
  };
}

function phaseDurationMs(state, phase) {
  const settings = state.settings.timer;
  const map = {
    implementation: settings.implementationMinutes,
    review: settings.reviewMinutes,
    shortBreak: settings.shortBreakMinutes,
    longBreak: settings.longBreakMinutes
  };
  return Math.max(0, Number(map[phase] || 0)) * 60_000;
}

function phaseIsFocus(phase) {
  return phase === "implementation" || phase === "review";
}

function accountFocus(state, from, to, phase) {
  if (!phaseIsFocus(phase) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
  const elapsed = to - from;
  state.timer.totalFocusMs = (state.timer.totalFocusMs || 0) + elapsed;
  const task = String(state.timer.currentTask || "Unassigned").trim() || "Unassigned";
  state.timer.focusMsByTask ||= {};
  state.timer.focusMsByTask[task] = (state.timer.focusMsByTask[task] || 0) + elapsed;
}

function setRunningPhase(state, phase, startAt) {
  const timer = state.timer;
  const duration = phaseDurationMs(state, phase);
  timer.phase = phase;
  timer.status = "running";
  timer.phaseStartedAt = startAt;
  timer.phaseEndAt = startAt + duration;
  timer.remainingMs = duration;
  timer.lastAccountedAt = startAt;
}

function setPausedAtPhaseStart(state, phase) {
  const duration = phaseDurationMs(state, phase);
  state.timer.phase = phase;
  state.timer.status = "paused";
  state.timer.phaseStartedAt = null;
  state.timer.phaseEndAt = null;
  state.timer.remainingMs = duration;
  state.timer.lastAccountedAt = null;
}

function setIdleAtPhaseStart(state, phase) {
  const duration = phaseDurationMs(state, phase);
  state.timer.phase = phase;
  state.timer.status = "idle";
  state.timer.phaseStartedAt = null;
  state.timer.phaseEndAt = null;
  state.timer.remainingMs = duration;
  state.timer.lastAccountedAt = null;
}

function transitionAt(state, boundaryAt, creditFocus = true) {
  const timer = state.timer;
  const previousPhase = timer.phase;
  // Don't credit a whole work phase if Chrome only gets a chance to process its alarm long after wake-up.
  if (creditFocus) accountFocus(state, timer.lastAccountedAt ?? timer.phaseStartedAt, boundaryAt, previousPhase);
  timer.lastAccountedAt = null;
  timer.history ||= [];

  if (previousPhase === "implementation") {
    setRunningPhase(state, "review", boundaryAt);
    return { from: previousPhase, to: "review" };
  }

  if (previousPhase === "review") {
    timer.totalCyclesCompleted = (timer.totalCyclesCompleted || 0) + 1;
    timer.roundsCompleted = (timer.roundsCompleted || 0) + 1;
    timer.history.push({
      at: boundaryAt,
      task: String(timer.currentTask || "").trim(),
      type: "problem-cycle",
      totalCyclesCompleted: timer.totalCyclesCompleted
    });
    if (timer.history.length > 500) timer.history = timer.history.slice(-500);

    const roundsPerSession = Math.max(1, Number(state.settings.timer.roundsPerSession) || 1);
    const isLongBreak = timer.roundsCompleted >= roundsPerSession;
    const nextBreak = isLongBreak ? "longBreak" : "shortBreak";
    const breakDuration = phaseDurationMs(state, nextBreak);
    if (isLongBreak && breakDuration === 0) {
      timer.roundsCompleted = 0;
      setRunningPhase(state, "implementation", boundaryAt);
      return { from: previousPhase, to: "implementation" };
    }
    if (!isLongBreak && breakDuration === 0) {
      setRunningPhase(state, "implementation", boundaryAt);
      return { from: previousPhase, to: "implementation" };
    }
    if (state.settings.timer.autoStartBreak) setRunningPhase(state, nextBreak, boundaryAt);
    else setPausedAtPhaseStart(state, nextBreak);
    return { from: previousPhase, to: nextBreak };
  }

  if (previousPhase === "shortBreak" || previousPhase === "longBreak") {
    if (previousPhase === "longBreak") timer.roundsCompleted = 0;
    if (state.settings.timer.autoStartFocus) setRunningPhase(state, "implementation", boundaryAt);
    else setIdleAtPhaseStart(state, "implementation");
    return { from: previousPhase, to: "implementation" };
  }

  setPausedAtPhaseStart(state, "implementation");
  return { from: previousPhase, to: "implementation" };
}

function processTimerUntilNow(state, now = Date.now()) {
  const timer = state.timer;
  const transitions = [];
  let count = 0;
  while (timer.status === "running" && timer.phaseEndAt && timer.phaseEndAt <= now && count < 500) {
    const boundary = timer.phaseEndAt;
    const creditFocus = now - boundary <= 120_000;
    transitions.push(transitionAt(state, boundary, creditFocus));
    count += 1;
    if (timer.status !== "running") break;
    // Zero-duration work phases are not expected, but prevent a malformed setting from looping forever.
    if (timer.phaseEndAt <= boundary) {
      setPausedAtPhaseStart(state, timer.phase);
      break;
    }
  }
  if (timer.status === "running" && timer.phaseEndAt) {
    timer.remainingMs = Math.max(0, timer.phaseEndAt - now);
  }
  return transitions;
}

function beginTimer(state, now = Date.now()) {
  const timer = state.timer;
  if (timer.status === "running") return;
  const phase = timer.phase || "implementation";
  let remaining = Math.max(0, Number(timer.remainingMs) || 0);
  if (remaining <= 0) remaining = phaseDurationMs(state, phase);
  timer.status = "running";
  timer.phaseStartedAt = now;
  timer.phaseEndAt = now + remaining;
  timer.remainingMs = remaining;
  timer.lastAccountedAt = now;
}

function pauseTimer(state, now = Date.now()) {
  const timer = state.timer;
  if (timer.status !== "running") return;
  const end = Math.min(now, timer.phaseEndAt || now);
  accountFocus(state, timer.lastAccountedAt ?? timer.phaseStartedAt, end, timer.phase);
  timer.remainingMs = Math.max(0, (timer.phaseEndAt || now) - now);
  timer.status = "paused";
  timer.phaseEndAt = null;
  timer.phaseStartedAt = null;
  timer.lastAccountedAt = null;
}

function resetTimer(state) {
  const timer = state.timer;
  timer.status = "idle";
  timer.phase = "implementation";
  timer.phaseStartedAt = null;
  timer.phaseEndAt = null;
  timer.remainingMs = phaseDurationMs(state, "implementation");
  timer.lastAccountedAt = null;
  timer.roundsCompleted = 0;
  timer.currentTask = "";
}

function timeUntilNextLocalMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2, 0);
  return next.getTime();
}

function isAllowedUrl(urlString, allowlist) {
  try {
    const url = new URL(urlString);
    if (!/^https?:$/.test(url.protocol)) return true;
    const host = url.hostname.toLowerCase();
    if (host === "leetcode.com" || host.endsWith(".leetcode.com")) return true;
    return (allowlist || []).some((item) => {
      const domain = String(item.domain || "").toLowerCase();
      if (!domain) return false;
      if (item.includeSubdomains) return host === domain || host.endsWith(`.${domain}`);
      return host === domain || host === `www.${domain}`;
    });
  } catch {
    return false;
  }
}

function createAllowRules(allowlist) {
  const rules = [];
  let id = RULE_ALLOW_BASE;
  for (const item of allowlist || []) {
    const domain = String(item.domain || "").trim().toLowerCase();
    if (!domain) continue;
    if (item.includeSubdomains) {
      rules.push({
        id: id++, priority: 10, action: { type: "allow" },
        condition: { requestDomains: [domain], resourceTypes: ["main_frame"] }
      });
    } else {
      const hosts = new Set([domain, `www.${domain}`]);
      for (const host of hosts) {
        for (const scheme of ["https", "http"]) {
          rules.push({
            id: id++, priority: 10, action: { type: "allow" },
            condition: { urlFilter: `|${scheme}://${host}/`, resourceTypes: ["main_frame"] }
          });
        }
      }
    }
  }
  rules.push({
    id: RULE_LEETCODE_ID, priority: 20, action: { type: "allow" },
    condition: { requestDomains: ["leetcode.com"], resourceTypes: ["main_frame"] }
  });
  return rules;
}

async function updateBlockingRules(state) {
  const status = effectiveStatus(state);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);
  const addRules = status.locked ? [
    {
      id: RULE_BLOCK_ID,
      priority: 1,
      action: { type: "redirect", redirect: { extensionPath: "/blocked.html" } },
      condition: { urlFilter: "|http", resourceTypes: ["main_frame"] }
    },
    ...createAllowRules(state.settings.allowlist)
  ] : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

async function scheduleAlarms(state) {
  await chrome.alarms.clear("daily-rollover");
  await chrome.alarms.create("daily-rollover", { when: timeUntilNextLocalMidnight() });
  await chrome.alarms.clear("timer-transition");
  if (state.timer.status === "running" && state.timer.phaseEndAt) {
    const when = Math.max(Date.now() + 1000, state.timer.phaseEndAt);
    await chrome.alarms.create("timer-transition", { when });
  }
  await chrome.alarms.clear("bypass-expiry");
  if (state.bypassUntil && state.bypassUntil > Date.now()) {
    await chrome.alarms.create("bypass-expiry", { when: Math.max(Date.now() + 1000, state.bypassUntil) });
  }
}

async function updateBadge(state) {
  const status = effectiveStatus(state);
  const text = status.dailyGate ? "DAY" : status.timerFocus ? "FOCUS" : status.bypassActive ? "OFF" : "";
  await chrome.action.setBadgeText({ text });
  if (status.dailyGate) await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
  else if (status.timerFocus) await chrome.action.setBadgeBackgroundColor({ color: "#5b5bd6" });
  else if (status.bypassActive) await chrome.action.setBadgeBackgroundColor({ color: "#64748b" });
}

async function getBlockedTargets() {
  const stored = await chrome.storage.local.get("blockedTargets");
  return stored.blockedTargets || {};
}

async function saveBlockedTargets(targets) {
  await chrome.storage.local.set({ blockedTargets: targets });
}

async function evictBlockedOpenTabs(state) {
  const status = effectiveStatus(state);
  const tabs = await chrome.tabs.query({});
  const blockedUrl = chrome.runtime.getURL("blocked.html");
  const targets = await getBlockedTargets();
  const updates = [];
  if (status.locked) {
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      const id = String(tab.id);
      if (tab.url.startsWith(blockedUrl)) {
        const original = targets[id];
        if (original && isAllowedUrl(original, state.settings.allowlist)) {
          updates.push(chrome.tabs.update(tab.id, { url: original }).catch(() => undefined));
          delete targets[id];
        }
        continue;
      }
      if (!isAllowedUrl(tab.url, state.settings.allowlist)) {
        targets[id] = tab.url;
        updates.push(chrome.tabs.update(tab.id, { url: blockedUrl }).catch(() => undefined));
      }
    }
  } else {
    for (const tab of tabs) {
      if (!tab.id) continue;
      const id = String(tab.id);
      const original = targets[id];
      if (original && tab.url?.startsWith(blockedUrl)) {
        updates.push(chrome.tabs.update(tab.id, { url: original }).catch(() => undefined));
        delete targets[id];
      } else if (original) {
        delete targets[id];
      }
    }
  }
  await saveBlockedTargets(targets);
  await Promise.all(updates);
}

async function reconcile(state) {
  await updateBlockingRules(state);
  await scheduleAlarms(state);
  await updateBadge(state);
  await evictBlockedOpenTabs(state);
}

function normalizeState(state) {
  const fresh = LF.makeInitialState();
  if (!state || typeof state !== "object") return fresh;
  state.schemaVersion = state.schemaVersion || fresh.schemaVersion;
  state.settings = { ...fresh.settings, ...(state.settings || {}) };
  state.settings.timer = { ...fresh.settings.timer, ...(state.settings?.timer || {}) };
  if (!Array.isArray(state.collections) || !state.collections.length) state.collections = fresh.collections;
  if (!state.settings.activeCollectionId || !state.collections.some((c) => c.id === state.settings.activeCollectionId)) {
    state.settings.activeCollectionId = state.collections[0].id;
  }
  state.allowlist = undefined;
  if (!Array.isArray(state.settings.allowlist)) state.settings.allowlist = LF.clone(fresh.settings.allowlist);
  state.seenByCollection ||= {};
  state.solvedSlugsByCollection ||= {};
  state.timer = { ...fresh.timer, ...(state.timer || {}) };
  state.timer.focusMsByTask ||= {};
  state.timer.history ||= [];
  state.bypassUntil ||= null;
  return state;
}

async function loadState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = normalizeState(stored[STATE_KEY]);
  ensureDaily(state);
  return state;
}

async function mutateState(mutator, shouldReconcile = true) {
  const op = operationQueue.then(async () => {
    const state = await loadState();
    const result = await mutator(state);
    ensureDaily(state);
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    if (shouldReconcile) await reconcile(state);
    return { state, result };
  });
  operationQueue = op.catch((error) => console.error("LeetCode Focus state operation failed", error));
  return op;
}

async function processTimerAlarm(state, now = Date.now()) {
  const transitions = processTimerUntilNow(state, now);
  if (transitions.length && state.settings.timer.notifications) {
    const final = transitions[transitions.length - 1];
    const labels = {
      implementation: "Implementation phase",
      review: "Solution review",
      shortBreak: "Short break",
      longBreak: "Long break"
    };
    try {
      await chrome.notifications.create(`lf-phase-${now}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "LeetCode Focus",
        message: `Now: ${labels[final.to] || final.to}`,
        priority: 0
      });
    } catch (error) {
      console.warn("Could not display phase notification", error);
    }
  }
  return transitions;
}

function validSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function importProblems(payload) {
  let items = Array.isArray(payload) ? payload : (payload && typeof payload === "object" ? (payload.problems || payload.items || payload.questions || payload.data || []) : []);
  if (!Array.isArray(items)) items = [];
  const mapped = [];
  for (const item of items) {
    let slug = "";
    let title = "";
    let url = "";
    if (typeof item === "string") {
      const match = item.match(/leetcode\.com\/problems\/([^/?#]+)/i);
      const cells = item.replace(/^\s*["']|["']\s*$/g, "").split(/[,\t;]/).map((cell) => cell.trim().replace(/^['"]|['"]$/g, ""));
      const headers = new Set(["slug", "url", "link", "title", "name", "difficulty", "question", "questiontitle", "titleslug"]);
      const slugCell = cells.find((cell) => /^[a-z0-9-]+$/i.test(cell) && cell.includes("-") && !headers.has(cell.toLowerCase()));
      slug = match ? match[1] : (slugCell || item.trim().toLowerCase());
      url = LF.problemUrl(slug);
    } else if (item && typeof item === "object") {
      url = String(item.url || item.link || item.problemUrl || item.question?.url || "");
      const match = url.match(/leetcode\.com\/problems\/([^/?#]+)/i);
      slug = String(item.slug || item.titleSlug || item.stat?.question__title_slug || item.question?.titleSlug || item.id || (match ? match[1] : "")).trim().toLowerCase();
      title = String(item.title || item.name || item.questionTitle || item.stat?.question__title || item.question?.title || "").trim();
      if (!url && slug) url = LF.problemUrl(slug);
    }
    if (!validSlug(slug)) continue;
    mapped.push({ slug, url: LF.problemUrl(slug), title: title || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) });
  }
  const seen = new Set();
  return mapped.filter((item) => {
    if (seen.has(item.slug)) return false;
    seen.add(item.slug);
    return true;
  });
}

async function handleMessage(message, sender) {
  const now = Date.now();
  if (message?.type === "GET_BLOCKED_TARGET") {
    const targets = await getBlockedTargets();
    const stored = await chrome.storage.local.get(STATE_KEY);
    return { state: normalizeState(stored[STATE_KEY]), result: { ok: true, originalUrl: sender?.tab?.id !== undefined ? (targets[String(sender.tab.id)] || null) : null } };
  }
  if (message?.type === "GET_STATE") {
    const stored = await chrome.storage.local.get(STATE_KEY);
    const raw = stored[STATE_KEY];
    const state = normalizeState(raw);
    const changed = ensureDaily(state, now);
    const timerTransitions = processTimerUntilNow(state, now);
    if (!raw || changed || timerTransitions.length) {
      const refreshed = await mutateState(async (s) => {
        processTimerUntilNow(s, now);
        return { ok: true };
      });
      return { ...refreshed, result: { ok: true } };
    }
    return { state, result: { ok: true } };
  }
  const { state, result } = await mutateState(async (s) => {
    if (!message || typeof message.type !== "string") return { ok: false, error: "Invalid message." };
    const collection = activeCollection(s);
    if (["START_TIMER", "PAUSE_TIMER", "RESUME_TIMER", "SKIP_PHASE", "SKIP_BREAK", "RESET_TIMER", "SET_TASK", "UPDATE_TIMER_SETTINGS"].includes(message.type)) {
      processTimerUntilNow(s, now);
    }

    switch (message.type) {
      case "START_TIMER":
        if (s.timer.status !== "running") beginTimer(s, now);
        return { ok: true };
      case "PAUSE_TIMER":
        pauseTimer(s, now);
        return { ok: true };
      case "RESUME_TIMER":
        beginTimer(s, now);
        return { ok: true };
      case "SKIP_PHASE": {
        if (s.timer.status === "running") {
          const phase = s.timer.phase;
          accountFocus(s, s.timer.lastAccountedAt ?? s.timer.phaseStartedAt, now, phase);
          s.timer.status = "running";
          // Move the current deadline to now so the same transition machinery handles phase accounting and cycle counts.
          s.timer.phaseEndAt = now;
          s.timer.lastAccountedAt = now;
          processTimerUntilNow(s, now);
        } else {
          const duration = phaseDurationMs(s, s.timer.phase);
          s.timer.status = "running";
          s.timer.phaseStartedAt = now;
          s.timer.phaseEndAt = now;
          s.timer.lastAccountedAt = now;
          s.timer.remainingMs = duration;
          processTimerUntilNow(s, now);
        }
        return { ok: true };
      }
      case "SKIP_BREAK": {
        if (s.timer.phase === "shortBreak" || s.timer.phase === "longBreak") {
          s.timer.status = "running";
          s.timer.phaseStartedAt = now;
          s.timer.phaseEndAt = now;
          s.timer.lastAccountedAt = now;
          processTimerUntilNow(s, now);
        }
        return { ok: true };
      }
      case "RESET_TIMER":
        if (s.timer.status === "running" && s.timer.lastAccountedAt) {
          accountFocus(s, s.timer.lastAccountedAt, Math.min(now, s.timer.phaseEndAt || now), s.timer.phase);
        }
        resetTimer(s);
        return { ok: true };
      case "SET_TASK":
        if (s.timer.status === "running" && s.timer.lastAccountedAt) {
          accountFocus(s, s.timer.lastAccountedAt, now, s.timer.phase);
          s.timer.lastAccountedAt = now;
        }
        s.timer.currentTask = String(message.task || "").slice(0, 120);
        return { ok: true };
      case "UPDATE_TIMER_SETTINGS": {
        const patch = message.settings || {};
        const numericFields = ["implementationMinutes", "reviewMinutes", "shortBreakMinutes", "longBreakMinutes", "roundsPerSession"];
        for (const key of numericFields) {
          if (patch[key] !== undefined) {
            const value = Number(patch[key]);
            if (!Number.isFinite(value)) continue;
            const min = key === "roundsPerSession" ? 1 : (key === "shortBreakMinutes" || key === "longBreakMinutes" ? 0 : 1);
            const max = key === "roundsPerSession" ? 100 : 24 * 60;
            s.settings.timer[key] = Math.min(max, Math.max(min, Math.round(value)));
          }
        }
        for (const key of ["autoStartFocus", "autoStartBreak", "notifications", "sound", "whiteNoise"]) {
          if (patch[key] !== undefined) s.settings.timer[key] = Boolean(patch[key]);
        }
        if (patch.theme && ["system", "light", "dark"].includes(patch.theme)) s.settings.timer.theme = patch.theme;
        if (typeof patch.accent === "string" && /^#[0-9a-f]{6}$/i.test(patch.accent)) s.settings.timer.accent = patch.accent;
        if (s.timer.status !== "running") s.timer.remainingMs = phaseDurationMs(s, s.timer.phase);
        return { ok: true };
      }
      case "SET_DAILY_ENABLED":
        s.settings.dailyEnabled = Boolean(message.enabled);
        return { ok: true };
      case "SET_BYPASS": {
        const minutes = Number(message.minutes);
        if (!Number.isFinite(minutes) || minutes <= 0) return { ok: false, error: "Enter a bypass duration greater than zero." };
        s.bypassUntil = now + Math.min(24 * 60, Math.max(1, minutes)) * 60_000;
        return { ok: true };
      }
      case "CLEAR_BYPASS":
        s.bypassUntil = null;
        return { ok: true };
      case "SAVE_ALLOWLIST": {
        const entries = Array.isArray(message.allowlist) ? message.allowlist : [];
        const normalized = [];
        const seen = new Set();
        for (const entry of entries) {
          let domain;
          try { domain = LF.normalizeDomain(entry.domain); } catch { continue; }
          const key = `${domain}|${Boolean(entry.includeSubdomains)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (domain === "leetcode.com" || domain.endsWith(".leetcode.com")) continue;
          normalized.push({ domain, includeSubdomains: Boolean(entry.includeSubdomains), label: String(entry.label || "Custom").slice(0, 60) });
        }
        s.settings.allowlist = normalized;
        return { ok: true, saved: normalized.length };
      }
      case "IMPORT_COLLECTION": {
        const name = String(message.name || "Imported List").trim().slice(0, 100) || "Imported List";
        const problems = importProblems(message.payload);
        if (!problems.length) return { ok: false, error: "No valid LeetCode problem URLs or slugs were found." };
        const id = `collection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        s.collections.push({ id, name, problems });
        s.seenByCollection[id] = [];
        s.solvedSlugsByCollection[id] = [];
        if (message.activate !== false) {
          s.settings.activeCollectionId = id;
          assignDaily(s, LF.localDateKey());
          s.nextSuggestionSlug = chooseUnseen(s, activeCollection(s), [s.daily?.slug].filter(Boolean))?.slug || null;
        }
        return { ok: true, id, count: problems.length };
      }
      case "SET_ACTIVE_COLLECTION": {
        if (!s.collections.some((item) => item.id === message.id)) return { ok: false, error: "Collection not found." };
        s.settings.activeCollectionId = message.id;
        assignDaily(s, LF.localDateKey());
        s.nextSuggestionSlug = chooseUnseen(s, activeCollection(s), [s.daily?.slug].filter(Boolean))?.slug || null;
        return { ok: true };
      }
      case "DELETE_COLLECTION": {
        if (message.id === "starter") return { ok: false, error: "The starter collection cannot be deleted." };
        s.collections = s.collections.filter((item) => item.id !== message.id);
        delete s.seenByCollection[message.id];
        delete s.solvedSlugsByCollection[message.id];
        if (!s.collections.length) s.collections = [{ id: "starter", name: "Starter Interview Set", problems: LF.starterProblems }];
        if (s.settings.activeCollectionId === message.id) {
          s.settings.activeCollectionId = s.collections[0].id;
          assignDaily(s, LF.localDateKey());
        }
        return { ok: true };
      }
      case "MARK_ACCEPTED": {
        if (!sender?.url) { return { ok: false, error: "Submission source is not LeetCode." }; }
        const senderHost = new URL(sender.url).hostname.toLowerCase();
        if (!(senderHost === "leetcode.com" || senderHost === "www.leetcode.com" || senderHost.endsWith(".leetcode.com"))) {
          return { ok: false, error: "Submission source is not LeetCode." };
        }
        const slug = String(message.slug || "").toLowerCase();
        if (!validSlug(slug)) return { ok: false, error: "Invalid problem slug." };
        const active = activeCollection(s);
        const collectionForSlug = s.collections.find((c) => c.problems.some((p) => p.slug === slug));
        if (collectionForSlug) {
          const solved = solvedList(s, collectionForSlug.id);
          if (!solved.includes(slug)) solved.push(slug);
          const seen = seenList(s, collectionForSlug.id);
          if (!seen.includes(slug)) seen.push(slug);
        }
        const completedDaily = Boolean(s.daily && s.daily.date === LF.localDateKey() && s.daily.collectionId === s.settings.activeCollectionId && s.daily.slug === slug);
        const completedSuggestion = Boolean(active && s.nextSuggestionSlug === slug);
        const acceptedInActiveCollection = Boolean(active && collectionForSlug?.id === active.id);
        if (completedDaily) {
          s.daily.complete = true;
          s.daily.completedAt = now;
        }
        if (active && (completedDaily || completedSuggestion || acceptedInActiveCollection)) {
          const seen = seenList(s, active.id);
          if (!seen.includes(slug)) seen.push(slug);
          // Refresh the popup's prepopulated optional problem after either daily or optional completion.
          s.nextSuggestionSlug = chooseUnseen(s, active, [s.daily?.slug, slug].filter(Boolean))?.slug || null;
        }
        return { ok: true, dailyComplete: Boolean(s.daily?.complete) };
      }
      case "SET_NEXT_SUGGESTION": {
        const slug = String(message.slug || "");
        if (slug && currentProblem(collection, slug) && slug !== s.daily?.slug) s.nextSuggestionSlug = slug;
        return { ok: true };
      }
      case "EXPORT_STATE":
        return { ok: true, exportData: s };
      case "RESTORE_STATE": {
        const incoming = normalizeState(message.data);
        if (!incoming || !Array.isArray(incoming.collections) || !incoming.collections.length) return { ok: false, error: "Backup format is not valid." };
        // Keep runtime-created time current, but restore user-facing state and history.
        Object.assign(s, incoming);
        return { ok: true };
      }
      default:
        return { ok: false, error: `Unknown command: ${message.type}` };
    }
  });
  return { state, result };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(({ state, result }) => sendResponse({ ...(result || { ok: true }), state, status: effectiveStatus(state) }))
    .catch((error) => {
      console.error("Message failed", message?.type, error);
      sendResponse({ ok: false, error: error?.message || "Unexpected extension error." });
    });
  return true;
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0 || !/^https?:/i.test(details.url)) return;
  (async () => {
    const stored = await chrome.storage.local.get(STATE_KEY);
    if (!stored[STATE_KEY]) return;
    const state = normalizeState(stored[STATE_KEY]);
    if (!effectiveStatus(state).locked || isAllowedUrl(details.url, state.settings.allowlist)) return;
    const targets = await getBlockedTargets();
    targets[String(details.tabId)] = details.url;
    await saveBlockedTargets(targets);
  })().catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  getBlockedTargets().then(async (targets) => { delete targets[String(tabId)]; await saveBlockedTargets(targets); }).catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!["daily-rollover", "timer-transition", "bypass-expiry"].includes(alarm.name)) return;
  mutateState(async (state) => {
    if (alarm.name === "timer-transition") await processTimerAlarm(state, Date.now());
    if (alarm.name === "bypass-expiry" && state.bypassUntil && state.bypassUntil <= Date.now()) state.bypassUntil = null;
    ensureDaily(state);
    return { ok: true };
  }).catch((error) => console.error("Alarm handling failed", error));
});

chrome.runtime.onInstalled.addListener(() => {
  mutateState(async (state) => {
    ensureDaily(state);
    return { ok: true };
  }).catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  mutateState(async (state) => {
    processTimerUntilNow(state, Date.now());
    ensureDaily(state);
    return { ok: true };
  }).catch(console.error);
});

// Reconcile even when the service worker wakes after an update or browser restore.
mutateState(async (state) => {
  processTimerUntilNow(state, Date.now());
  ensureDaily(state);
  return { ok: true };
}).catch(console.error);
