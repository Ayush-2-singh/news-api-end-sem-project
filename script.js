/* ============================================================
   PULSE NEWS APP — script.js
   Architecture: Modular functions, async/await, localStorage cache,
   debounced search, pagination, dark mode.
   ============================================================ */

"use strict";

/* ============================================================
   1. CONFIGURATION
   ============================================================ */

// 🔑 Replace with your actual NewsAPI key from https://newsapi.org/
const API_KEY = "51c4dc47ce8f4085859608c43b83ea2c";

// NewsAPI base URL — using "everything" endpoint for searches,
// "top-headlines" for category browsing
const BASE_URL = "https://newsapi.org/v2";

// How many articles per page
const PAGE_SIZE = 9;

// Placeholder for articles with missing images
const PLACEHOLDER_IMG = "https://placehold.co/600x400/1A1A1A/9A9590?text=No+Image";

// localStorage key for caching
const CACHE_KEY = "pulse_news_cache";

/* ============================================================
   2. APP STATE
   All mutable state lives here — single source of truth
   ============================================================ */
const state = {
  currentCategory: "general",   // active category
  currentQuery: "",              // active search keyword
  currentPage: 1,                // current pagination page
  totalResults: 0,               // total results from API
  articles: [],                  // currently displayed articles
  lastRetryAction: null,         // function to call on "Retry"
  debounceTimer: null,           // reference for debounced search
};

/* ============================================================
   3. DOM REFERENCES
   Grab all elements once; avoids repeated querySelector calls
   ============================================================ */
const DOM = {
  newsGrid:     document.getElementById("newsGrid"),
  loader:       document.getElementById("loader"),
  errorWrap:    document.getElementById("errorWrap"),
  errorMsg:     document.getElementById("errorMsg"),
  noResults:    document.getElementById("noResults"),
  retryBtn:     document.getElementById("retryBtn"),
  searchInput:  document.getElementById("searchInput"),
  searchBtn:    document.getElementById("searchBtn"),
  themeToggle:  document.getElementById("themeToggle"),
  themeIcon:    document.getElementById("themeIcon"),
  catBtns:      document.querySelectorAll(".cat-btn"),
  pagination:   document.getElementById("pagination"),
  prevBtn:      document.getElementById("prevBtn"),
  nextBtn:      document.getElementById("nextBtn"),
  pageInfo:     document.getElementById("pageInfo"),
  sectionTitle: document.getElementById("sectionTitle"),
  sectionMeta:  document.getElementById("sectionMeta"),
};

/* ============================================================
   4. API FUNCTIONS
   ============================================================ */

/**
 * fetchNews()
 * Central function that builds the URL and calls the API.
 *
 * @param {string} query    - search keyword (for /everything)
 * @param {string} category - news category (for /top-headlines)
 * @param {number} page     - page number for pagination
 * @returns {Promise<Object>} - parsed JSON from NewsAPI
 *
 * Async/await explanation:
 * - `async` marks the function as asynchronous; it always returns a Promise.
 * - `await` pauses execution inside the function until the Promise resolves.
 * - This reads like synchronous code but doesn't block the main thread.
 */
async function fetchNews(query = "", category = "general", page = 1) {
  let url;

  if (query.trim()) {
  url = `${BASE_URL}/everything?q=${encodeURIComponent(query)}&language=en&pageSize=${PAGE_SIZE}&page=${page}&sortBy=publishedAt&apiKey=${API_KEY}`;
} else {
  url = `${BASE_URL}/top-headlines?category=${category}&country=us&pageSize=${PAGE_SIZE}&page=${page}&apiKey=${API_KEY}`;
}

  // fetch() returns a Promise; await resolves it to a Response object
  const response = await fetch(url);

  // The API can return non-200 codes (e.g. 401 for bad key, 429 for rate limit)
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP error ${response.status}`);
  }

  // .json() also returns a Promise; await resolves it to a plain JS object
  const data = await response.json();

  // NewsAPI returns status: "error" even with HTTP 200 in some edge cases
  if (data.status !== "ok") {
    throw new Error(data.message || "API returned an unexpected response");
  }

  return data;
}

/* ============================================================
   5. UI STATE FUNCTIONS
   These control which UI panel is visible at any time
   ============================================================ */

/** Show the loading spinner, hide everything else */
function showLoader() {
  DOM.loader.hidden    = false;
  DOM.errorWrap.hidden = true;
  DOM.noResults.hidden = true;
  DOM.newsGrid.hidden  = true;
  DOM.pagination.hidden = true;
}

/** Hide the loading spinner */
function hideLoader() {
  DOM.loader.hidden = true;
}

/**
 * showError()
 * Display an error message with a retry button.
 * @param {string} message - human-readable error text
 * @param {Function} retryFn - function to call when user clicks Retry
 */
function showError(message, retryFn) {
  hideLoader();
  DOM.errorMsg.textContent   = message;
  DOM.errorWrap.hidden       = false;
  DOM.newsGrid.hidden        = true;
  DOM.pagination.hidden      = true;
  state.lastRetryAction      = retryFn;
}

/** Show the "no results" panel */
function showNoResults() {
  hideLoader();
  DOM.noResults.hidden  = false;
  DOM.newsGrid.hidden   = true;
  DOM.pagination.hidden = true;
}

/** Clear all articles from the grid */
function clearNews() {
  DOM.newsGrid.innerHTML = "";
  DOM.errorWrap.hidden   = true;
  DOM.noResults.hidden   = true;
}

/* ============================================================
   6. RENDER FUNCTIONS
   ============================================================ */

/**
 * formatDate()
 * Converts ISO date string to a readable format e.g. "Jun 16, 2026"
 * @param {string} isoString
 * @returns {string}
 */
function formatDate(isoString) {
  if (!isoString) return "Unknown date";
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

/**
 * createCard()
 * Builds and returns a single news article card DOM element.
 * @param {Object} article - a single article object from NewsAPI
 * @returns {HTMLElement}
 */
function createCard(article) {
  const {
    title, description, urlToImage, url,
    publishedAt, source,
  } = article;

  // Guard: skip articles that are "[Removed]" (NewsAPI sometimes returns these)
  if (!title || title === "[Removed]") return null;

  const card = document.createElement("article");
  card.className = "news-card";

  // Use placeholder if image is missing or null
  const imgSrc = urlToImage || PLACEHOLDER_IMG;
  const sourceName = source?.name || "Unknown";
  const dateStr    = formatDate(publishedAt);
  const desc       = description || "No description available.";

  card.innerHTML = `
    <div class="card-img-wrap">
      <img
        src="${imgSrc}"
        alt="${title}"
        loading="lazy"
        onerror="this.src='${PLACEHOLDER_IMG}'"
      />
    </div>
    <div class="card-body">
      <div class="card-meta">
        <span class="card-source">${sourceName}</span>
        <span class="card-date">${dateStr}</span>
      </div>
      <h2 class="card-title">${title}</h2>
      <p class="card-desc">${desc}</p>
      <a
        href="${url}"
        target="_blank"
        rel="noopener noreferrer"
        class="card-link"
      >
        Read More
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="12 5 19 12 12 19"/>
        </svg>
      </a>
    </div>
  `;

  return card;
}

/**
 * renderNews()
 * Takes array of articles, clears grid, renders all cards.
 * @param {Array} articles - array of article objects
 */
function renderNews(articles) {
  clearNews();
  hideLoader();

  // Handle empty array
  if (!articles || articles.length === 0) {
    showNoResults();
    return;
  }

  DOM.newsGrid.hidden = false;

  // Use DocumentFragment for performance — one DOM insertion instead of N
  const fragment = document.createDocumentFragment();

  articles.forEach((article) => {
    const card = createCard(article);
    if (card) fragment.appendChild(card);
  });

  DOM.newsGrid.appendChild(fragment);
  updatePagination();
}

/* ============================================================
   7. PAGINATION
   ============================================================ */

/** Update pagination UI based on current state */
function updatePagination() {
  const totalPages = Math.ceil(state.totalResults / PAGE_SIZE);

  // Hide pagination if only 1 page or 0 results
  if (totalPages <= 1) {
    DOM.pagination.hidden = true;
    return;
  }

  DOM.pagination.hidden       = false;
  DOM.pageInfo.textContent    = `Page ${state.currentPage} of ${totalPages}`;
  DOM.prevBtn.disabled        = state.currentPage <= 1;
  DOM.nextBtn.disabled        = state.currentPage >= totalPages;
}

/** Go to previous page */
DOM.prevBtn.addEventListener("click", () => {
  if (state.currentPage > 1) {
    state.currentPage--;
    loadCurrentView();
  }
});

/** Go to next page */
DOM.nextBtn.addEventListener("click", () => {
  const totalPages = Math.ceil(state.totalResults / PAGE_SIZE);
  if (state.currentPage < totalPages) {
    state.currentPage++;
    loadCurrentView();
  }
});

/* ============================================================
   8. CORE LOAD FUNCTION
   ============================================================ */

/**
 * loadCurrentView()
 * Reads current state and fetches/renders appropriate news.
 * This is the single entry point for all data loading.
 */
async function loadCurrentView() {
  showLoader();

  // Update section heading
  if (state.currentQuery.trim()) {
    DOM.sectionTitle.textContent = `Results for "${state.currentQuery}"`;
  } else {
    const catLabel = document.querySelector(".cat-btn.active")?.textContent || "Top Stories";
    DOM.sectionTitle.textContent = catLabel;
  }

  try {
    const data = await fetchNews(state.currentQuery, state.currentCategory, state.currentPage);

    state.totalResults = data.totalResults || 0;
    state.articles     = data.articles || [];

    // Update result count in heading
    DOM.sectionMeta.textContent = state.totalResults
      ? `${state.totalResults.toLocaleString()} stories`
      : "";

    renderNews(state.articles);

    // Cache results to localStorage for offline/reload restore
    saveToCache(state.articles);

    // Scroll back to top of content on page change
    window.scrollTo({ top: 120, behavior: "smooth" });

  } catch (err) {
    // If we have cached data, show it with a warning
    const cached = loadFromCache();
    if (cached && state.currentPage === 1 && !state.currentQuery) {
      renderNews(cached);
      DOM.sectionMeta.textContent = "(showing cached results)";
    } else {
      showError(err.message || "Network error. Check your connection.", loadCurrentView);
    }

    console.error("Pulse fetchNews error:", err);
  }
}

/* ============================================================
   9. CATEGORY FILTER
   ============================================================ */

DOM.catBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    // Skip if already active
    if (btn.classList.contains("active") && !state.currentQuery) return;

    // Update active state
    DOM.catBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // Reset state for new category
    state.currentCategory = btn.dataset.category;
    state.currentQuery    = "";
    state.currentPage     = 1;
    DOM.searchInput.value = "";

    loadCurrentView();
  });
});

/* ============================================================
   10. SEARCH
   ============================================================ */

/**
 * triggerSearch()
 * Validates input then kicks off a search fetch.
 */
function triggerSearch() {
  const query = DOM.searchInput.value.trim();

  if (!query) {
    // Empty search → just flash the input border red
    DOM.searchInput.style.borderColor = "var(--accent)";
    setTimeout(() => { DOM.searchInput.style.borderColor = ""; }, 1200);
    return;
  }

  state.currentQuery = query;
  state.currentPage  = 1;

  // Deactivate category buttons visually (we're in search mode)
  DOM.catBtns.forEach((b) => b.classList.remove("active"));

  loadCurrentView();
}

// Search button click
DOM.searchBtn.addEventListener("click", triggerSearch);

// Press Enter in search box
DOM.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") triggerSearch();
});

/**
 * Debounced search — fires 500ms after user stops typing.
 * Debounce explanation: each keystroke clears the previous timer
 * and starts a new 500ms countdown. The API is only called once
 * the user pauses, preventing a flood of requests on every key.
 */
DOM.searchInput.addEventListener("input", () => {
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    const query = DOM.searchInput.value.trim();
    if (query.length >= 3) {
      // Auto-trigger if user has typed at least 3 characters
      state.currentQuery = query;
      state.currentPage  = 1;
      DOM.catBtns.forEach((b) => b.classList.remove("active"));
      loadCurrentView();
    }
  }, 500);
});

/* ============================================================
   11. RETRY BUTTON
   ============================================================ */

DOM.retryBtn.addEventListener("click", () => {
  if (typeof state.lastRetryAction === "function") {
    state.lastRetryAction();
  }
});

/* ============================================================
   12. DARK MODE TOGGLE
   ============================================================ */

/** applyTheme() — sets data-theme attribute and updates icon */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  DOM.themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem("pulse_theme", theme);
}

DOM.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

/** Restore theme preference on load */
function initTheme() {
  const saved = localStorage.getItem("pulse_theme");
  if (saved) {
    applyTheme(saved);
  } else {
    // Respect OS preference
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }
}

/* ============================================================
   13. LOCAL STORAGE CACHE
   ============================================================ */

/**
 * saveToCache()
 * Saves the latest batch of articles to localStorage.
 * localStorage explanation: a synchronous key-value store in the browser.
 * Data persists across page reloads but stays on the user's device only.
 * Values must be strings, so we JSON.stringify objects.
 *
 * @param {Array} articles
 */
function saveToCache(articles) {
  try {
    const payload = {
      articles,
      savedAt: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (e) {
    // Storage can fail if quota is exceeded — silently ignore
    console.warn("Cache write failed:", e);
  }
}

/**
 * loadFromCache()
 * Returns cached articles if they exist and are < 30 minutes old.
 * @returns {Array|null}
 */
function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const { articles, savedAt } = JSON.parse(raw);
    const THIRTY_MIN = 30 * 60 * 1000;

    if (Date.now() - savedAt > THIRTY_MIN) {
      // Cache is stale — clear and return null
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    return articles;
  } catch (e) {
    return null;
  }
}

/* ============================================================
   14. RESET / HOME
   ============================================================ */

/**
 * resetToHome()
 * Clicking the logo resets everything and goes back to top headlines.
 */
function resetToHome() {
  state.currentQuery    = "";
  state.currentCategory = "general";
  state.currentPage     = 1;
  DOM.searchInput.value = "";

  DOM.catBtns.forEach((b) => b.classList.remove("active"));
  document.querySelector('[data-category="general"]')?.classList.add("active");

  loadCurrentView();
}

// Make resetToHome accessible from HTML onclick (attached to logo anchor)
window.resetToHome = resetToHome;

/* ============================================================
   15. INIT — RUNS ON PAGE LOAD
   ============================================================ */

/**
 * init()
 * Entry point. Restores theme, checks cache, fetches news.
 */
async function init() {
  // 1. Apply saved theme
  initTheme();

  // 2. Try to restore cached news first for instant load
  const cached = loadFromCache();
  if (cached && cached.length > 0) {
    state.articles     = cached;
    state.totalResults = cached.length;
    renderNews(cached);
    DOM.sectionMeta.textContent = "(from cache — refreshing…)";

    // Then fetch fresh data in the background
    try {
      const data = await fetchNews("", "general", 1);
      state.totalResults = data.totalResults || 0;
      state.articles     = data.articles || [];
      renderNews(state.articles);
      DOM.sectionMeta.textContent = `${state.totalResults.toLocaleString()} stories`;
      saveToCache(state.articles);
    } catch {
      // Background refresh failed — cached data is still showing, that's fine
      DOM.sectionMeta.textContent = "(cached results)";
    }
  } else {
    // No cache — normal load
    await loadCurrentView();
  }
}

// Kick off the app
init();
