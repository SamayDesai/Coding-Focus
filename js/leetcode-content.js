(() => {
  if (window.__leetcodeFocusContentLoaded) return;
  window.__leetcodeFocusContentLoaded = true;

  const slugFromLocation = () => {
    const match = location.pathname.match(/\/problems\/([^/]+)/i);
    return match ? match[1].toLowerCase() : "";
  };

  let armedAt = 0;
  let deadline = 0;
  let priorNodes = new Map();
  let sawPending = false;
  let reported = false;
  let interval = null;
  let observer = null;

  function candidateNodes() {
    const selectors = [
      '[data-e2e-locator*="submission"]',
      '[data-e2e-locator*="result"]',
      '[data-testid*="submission"]',
      '[data-testid*="result"]',
      '[class*="result"]',
      '[class*="status"]',
      'span', 'div', 'p'
    ];
    const found = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach((node) => {
          const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
          if (text.length > 0 && text.length < 240 && /^(accepted|wrong answer|time limit exceeded|runtime error|compile error|pending|judging|submitting|running)\b/i.test(text)) {
            found.add(node);
          }
        });
      } catch (_) {}
    }
    return [...found];
  }

  function armSubmissionAttempt() {
    armedAt = Date.now();
    deadline = armedAt + 120_000;
    priorNodes = new Map(candidateNodes().map((node) => [node, String(node.textContent || "").replace(/\s+/g, " ").trim()]));
    sawPending = false;
    reported = false;
    if (!interval) interval = setInterval(checkSubmissionResult, 350);
  }

  function checkSubmissionResult() {
    if (!armedAt || reported) return;
    if (Date.now() > deadline) {
      clearInterval(interval);
      interval = null;
      armedAt = 0;
      priorNodes.clear();
      return;
    }
    const nodes = candidateNodes();
    const normalized = nodes.map((node) => ({ node, text: String(node.textContent || "").replace(/\s+/g, " ").trim() }));
    if (normalized.some(({ text }) => /^(pending|judging|submitting|running)\b/i.test(text))) sawPending = true;
    const accepted = normalized.find(({ node, text }) => {
      if (!/^accepted\b/i.test(text)) return false;
      const priorText = priorNodes.get(node);
      return !priorNodes.has(node) || priorText !== text || sawPending;
    });
    if (accepted) {
      reported = true;
      const slug = slugFromLocation();
      if (slug) {
        chrome.runtime.sendMessage({ type: "MARK_ACCEPTED", slug, observedAt: Date.now() }, () => {
          // A service-worker restart can briefly make the callback fail; content detection remains local.
          void chrome.runtime.lastError;
        });
      }
      clearInterval(interval);
      interval = null;
      armedAt = 0;
    }
  }

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!target) return;
    const button = target.closest('button, [role="button"]');
    if (!button) return;
    const text = String(button.innerText || button.textContent || "").replace(/\s+/g, " ").trim();
    const aria = String(button.getAttribute("aria-label") || "").trim();
    if (/^(submit|submit code)$/i.test(text) || /submit/i.test(aria)) {
      setTimeout(armSubmissionAttempt, 0);
    }
  }

  window.addEventListener("click", handleClick, true);
  observer = new MutationObserver(() => {
    if (armedAt && !reported) checkSubmissionResult();
  });
  const attachObserver = () => {
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    else setTimeout(attachObserver, 100);
  };
  attachObserver();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "RECHECK_ACCEPTED") return false;
    const slug = slugFromLocation();
    const acceptedNode = candidateNodes().find((node) => /^accepted\b/i.test(String(node.textContent || "").replace(/\s+/g, " ").trim()));
    if (!slug || !acceptedNode) {
      sendResponse({ ok: false, error: "No visible Accepted result was found on this LeetCode problem page. Submit the problem and wait for the result." });
      return false;
    }
    chrome.runtime.sendMessage({ type: "MARK_ACCEPTED", slug, observedAt: Date.now(), manualRecheck: true }, (response) => {
      const error = chrome.runtime.lastError;
      sendResponse(error ? { ok: false, error: error.message } : (response || { ok: false, error: "Could not verify completion." }));
    });
    return true;
  });
})();
