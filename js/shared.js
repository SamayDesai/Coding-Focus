/* Shared defaults and pure helpers for LeetCode Focus. */
(function (root) {
  const starterSlugs = [
    "two-sum", "contains-duplicate", "valid-anagram", "group-anagrams", "top-k-frequent-elements",
    "product-of-array-except-self", "valid-sudoku", "longest-consecutive-sequence", "valid-palindrome",
    "two-sum-ii-input-array-is-sorted", "3sum", "container-with-most-water", "trapping-rain-water",
    "best-time-to-buy-and-sell-stock", "longest-substring-without-repeating-characters",
    "longest-repeating-character-replacement", "minimum-window-substring", "valid-parentheses", "min-stack",
    "evaluate-reverse-polish-notation", "generate-parentheses", "daily-temperatures", "car-fleet",
    "largest-rectangle-in-histogram", "binary-search", "search-a-2d-matrix", "koko-eating-bananas",
    "find-minimum-in-rotated-sorted-array", "search-in-rotated-sorted-array", "time-based-key-value-store",
    "merge-intervals", "insert-interval", "non-overlapping-intervals",
    "reverse-linked-list", "merge-two-sorted-lists", "reorder-list", "remove-nth-node-from-end-of-list",
    "linked-list-cycle", "find-the-duplicate-number", "invert-binary-tree", "maximum-depth-of-binary-tree",
    "same-tree", "subtree-of-another-tree", "lowest-common-ancestor-of-a-binary-search-tree",
    "binary-tree-level-order-traversal", "validate-binary-search-tree", "kth-smallest-element-in-a-bst",
    "construct-binary-tree-from-preorder-and-inorder-traversal", "kth-largest-element-in-an-array",
    "last-stone-weight", "k-closest-points-to-origin", "number-of-islands", "clone-graph", "max-area-of-island",
    "pacific-atlantic-water-flow", "course-schedule", "course-schedule-ii",
    "redundant-connection", "climbing-stairs", "house-robber", "house-robber-ii", "longest-palindromic-substring",
    "palindromic-substrings", "decode-ways", "coin-change", "maximum-product-subarray", "word-break",
    "longest-increasing-subsequence", "partition-equal-subset-sum", "unique-paths", "longest-common-subsequence",
    "single-number", "number-of-1-bits", "counting-bits", "reverse-bits", "missing-number", "implement-trie-prefix-tree",
    "word-search-ii", "combination-sum", "permutations", "subsets", "subsets-ii",
    "letter-combinations-of-a-phone-number", "n-queens", "lru-cache", "insert-delete-getrandom-o1",
    "task-scheduler", "find-median-from-data-stream", "word-search", "rotting-oranges",
    "find-first-and-last-position-of-element-in-sorted-array", "jump-game", "jump-game-ii", "gas-station",
    "sort-colors", "spiral-matrix", "rotate-image", "set-matrix-zeroes", "minimum-path-sum", "edit-distance"
  ];

  const starterProblems = starterSlugs.map((slug) => ({
    slug,
    url: `https://leetcode.com/problems/${slug}/`,
    title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  }));

  const googleSearchDomains = [
    "google.com", "google.fr", "google.co.uk", "google.de", "google.es", "google.it", "google.ca",
    "google.com.au", "google.co.in", "google.co.jp", "google.nl", "google.be", "google.ch", "google.at",
    "google.se", "google.no", "google.dk", "google.fi", "google.pl", "google.pt", "google.ie", "google.gr",
    "google.cz", "google.hu", "google.ro", "google.com.br", "google.com.mx", "google.com.tr", "google.co.kr",
    "google.com.sg", "google.com.hk", "google.co.za", "google.com.ar", "google.cl", "google.co.id", "google.co.th",
    "google.com.tw", "google.com.vn", "google.com.my", "google.com.ph", "google.com.co", "google.com.pe",
    "google.com.pk", "google.com.ng", "google.com.ua", "google.rs", "google.hr", "google.sk", "google.si",
    "google.bg", "google.lt", "google.lv", "google.ee", "google.is", "google.lu", "google.com.eg", "google.co.il"
  ];

  const defaultAllowlist = [
    { domain: "mail.google.com", includeSubdomains: true, label: "Gmail" },
    { domain: "calendar.google.com", includeSubdomains: true, label: "Google Calendar" },
    { domain: "accounts.google.com", includeSubdomains: true, label: "Google Account" },
    { domain: "consent.google.com", includeSubdomains: true, label: "Google Consent" },
    ...googleSearchDomains.map((domain) => ({ domain, includeSubdomains: false, label: "Google Search" }))
  ];

  const defaultSettings = {
    dailyEnabled: true,
    activeCollectionId: "starter",
    allowlist: defaultAllowlist,
    timer: {
      implementationMinutes: 30,
      reviewMinutes: 20,
      shortBreakMinutes: 5,
      longBreakMinutes: 30,
      roundsPerSession: 10,
      autoStartFocus: true,
      autoStartBreak: true,
      notifications: true,
      sound: true,
      whiteNoise: false,
      theme: "system",
      accent: "#5b5bd6"
    }
  };

  function makeInitialState() {
    const state = {
      schemaVersion: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: structuredCloneSafe(defaultSettings),
      collections: [{ id: "starter", name: "Starter Interview Set", problems: starterProblems }],
      daily: null,
      seenByCollection: { starter: [] },
      solvedSlugsByCollection: { starter: [] },
      nextSuggestionSlug: null,
      bypassUntil: null,
      timer: {
        status: "idle",
        phase: "implementation",
        phaseStartedAt: null,
        phaseEndAt: null,
        remainingMs: 30 * 60 * 1000,
        lastAccountedAt: null,
        roundsCompleted: 0,
        totalCyclesCompleted: 0,
        currentTask: "",
        totalFocusMs: 0,
        focusMsByTask: {},
        history: []
      }
    };
    return state;
  }

  function structuredCloneSafe(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function problemTitle(problem) {
    return problem?.title || (problem?.slug || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function problemUrl(problemOrSlug) {
    const slug = typeof problemOrSlug === "string" ? problemOrSlug : problemOrSlug?.slug;
    return slug ? `https://leetcode.com/problems/${slug}/` : "https://leetcode.com/problemset/";
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function normalizeDomain(value) {
    let raw = String(value || "").trim().toLowerCase();
    if (!raw) throw new Error("Enter a domain name.");
    if (!raw.includes("://")) raw = `https://${raw}`;
    let url;
    try { url = new URL(raw); } catch { throw new Error(`Invalid domain: ${value}`); }
    if (!/^https?:$/.test(url.protocol)) throw new Error("Use a hostname, not a non-web URL.");
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!host || host.includes("_") || !/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".")) {
      throw new Error(`Invalid hostname: ${host}`);
    }
    return host;
  }

  root.LF = {
    starterProblems,
    defaultAllowlist,
    defaultSettings,
    makeInitialState,
    localDateKey,
    problemTitle,
    problemUrl,
    formatDuration,
    normalizeDomain,
    clone: structuredCloneSafe
  };
})(globalThis);
