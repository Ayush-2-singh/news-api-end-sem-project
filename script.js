/* ============================================================
   PULSE NEWS APP — script.js
   API: GNews (gnews.io) — works on deployed sites, no CORS issues
   Architecture: Modular functions, async/await, localStorage cache,
   debounced search, pagination, dark mode.
   ============================================================ */

"use strict";

/* ============================================================
   1. CONFIGURATION
   ============================================================ */

// 🔑 Your GNews API key from https://gnews.io
const API_KEY = "5eea2bb80306f73c0a60d76c1d53ddc4";

const BASE_URL = "https://gnews.io/api/v4";

// GNews free plan max is 10 per request
const PAGE_SIZE = 9;

const PLACEHOLDER_IMG = "https://placehold.co/600x400/1A1A1A/9A9590?text=No+Image";
const CACHE_KEY = "pulse_news_cache";

/* ============================================================
   2. CATEGORY MAP
   GNews category names differ slightly from NewsAPI
   ============================================================ */
const CATEGORY_MAP = {
  general:       "general",
  technology:    "technology",
  business:      "business",
  sports:        "sports",
  health:        "health",
  science:       "science",
  entertainment: "entertainment",
};

/* ============================================================
   3. APP STATE
   ============================================================ */
const state = {
  currentCategory: "general",
  currentQuery:    "",
  currentPage:     1,
  totalResults:    0,
  articles:        [],
  lastRetryAction: null,
  debounceTimer:   null,
};

/* ============================================================
   4. DOM REFERENCES
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
   5. API — GNews
   ============================================================ */

/**
 * fetchNews()
 * Calls GNews API for either search or top-headlines.
 *
 * GNews response shape:
 * {
 *   totalArticles: number,
 *   articles: [{ title, description, url, image, publishedAt, source: { name, url } }]
 * }
 *
 * We normalize it to match the rest of our code.
 */
async function fetchNews(query = "", category = "general", page = 1) {
  let url;

  // GNews free plan doesn't support true pagination offset,
  // so we fetch max and slice — works fine for free tier
  const max = PAGE_SIZE;

  if (query.trim()) {
    // Search mode
    url = `${BASE_URL}/search?q=${encodeURIComponent(query)}&lang=en&max=${max}&apikey=${API_KEY}`;
  } else {
    // Category / top-headlines mode
    const cat = CATEGORY_MAP[category] || "general";
    url = `${BASE_URL}/top-headlines?category=${cat}&lang=en&max=${max}&apikey=${API_KEY}`;
  }

  const response = await fetch(url);

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.errors?.[0] || `Request failed (${response.status})`);
  }

  const data = await response.json();

  // GNews uses `image` not `urlToImage` — normalize here so
  // the rest of the code doesn't need to change
  const normalized = (data.articles || []).map((a) => ({
    title:       a.title,
    description: a.description,
    url:         a.url,
    urlToImage:  a.image,           // normalize field name
    publishedAt: a.publishedAt,
    source:      { name: a.source?.name || "Unknown" },
  }));

  return {
    status:       "ok",
    articles:     normalized,
    totalResults: data.totalArticles || normalized.length,
  };
}

/* ============================================================
   6. UI STATE FUNCTIONS
   ============================================================ */

function showLoader() {
  DOM.loader.hidden     = false;
  DOM.errorWrap.hidden  = true;
  DOM.noResults.hidden  = true;
  DOM.newsGrid.hidden   = true;
  DOM.pagination.hidden = true;
}

function hideLoader() {
  DOM.loader.hidden = true;
}

function showError(message, retryFn) {
  hideLoader();
  DOM.errorMsg.textContent  = message;
  DOM.errorWrap.hidden      = false;
  DOM.newsGrid.hidden       = true;
  DOM.pagination.hidden     = true;
  state.lastRetryAction     = retryFn;
}

function showNoResults() {
  hideLoader();
  DOM.noResults.hidden  = false;
  DOM.newsGrid.hidden   = true;
  DOM.pagination.hidden = true;
}

function clearNews() {
  DOM.newsGrid.innerHTML = "";
  DOM.errorWrap.hidden   = true;
  DOM.noResults.hidden   = true;
}

/* ============================================================
   7. RENDER
   ============================================================ */

function formatDate(isoString) {
  if (!isoString) return "Unknown date";
  return new Date(isoString).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function createCard(article) {
  const { title, description, urlToImage, url, publishedAt, source } = article;

  if (!title || title === "[Removed]") return null;

  const card      = document.createElement("article");
  card.className  = "news-card";

  const imgSrc     = urlToImage || PLACEHOLDER_IMG;
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
      <a href="${url}" target="_blank" rel="noopener noreferrer" class="card-link">
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

function renderNews(articles) {
  clearNews();
  hideLoader();

  if (!articles || articles.length === 0) {
    showNoResults();
    return;
  }

  DOM.newsGrid.hidden = false;

  const fragment = document.createDocumentFragment();
  articles.forEach((article) => {
    const card = createCard(article);
    if (card) fragment.appendChild(card);
  });

  DOM.newsGrid.appendChild(fragment);
  updatePagination();
}

/* ============================================================
   8. PAGINATION
   ============================================================ */

function updatePagination() {
  const totalPages = Math.ceil(state.totalResults / PAGE_SIZE);

  if (totalPages <= 1) {
    DOM.pagination.hidden = true;
    return;
  }

  DOM.pagination.hidden    = false;
  DOM.pageInfo.textContent = `Page ${state.currentPage} of ${totalPages}`;
  DOM.prevBtn.disabled     = state.currentPage <= 1;
  DOM.nextBtn.disabled     = state.currentPage >= totalPages;
}

DOM.prevBtn.addEventListener("click", () => {
  if (state.currentPage > 1) {
    state.currentPage--;
    loadCurrentView();
  }
});

DOM.nextBtn.addEventListener("click", () => {
  const totalPages = Math.ceil(state.totalResults / PAGE_SIZE);
  if (state.currentPage < totalPages) {
    state.currentPage++;
    loadCurrentView();
  }
});

/* ============================================================
   9. CORE LOAD
   ============================================================ */

async function loadCurrentView() {
  showLoader();

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

    DOM.sectionMeta.textContent = state.totalResults
      ? `${state.totalResults.toLocaleString()} stories`
      : "";

    renderNews(state.articles);
    saveToCache(state.articles);
    window.scrollTo({ top: 120, behavior: "smooth" });

  } catch (err) {
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
   10. CATEGORY FILTER
   ============================================================ */

DOM.catBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("active") && !state.currentQuery) return;

    DOM.catBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    state.currentCategory = btn.dataset.category;
    state.currentQuery    = "";
    state.currentPage     = 1;
    DOM.searchInput.value = "";

    loadCurrentView();
  });
});

/* ============================================================
   11. SEARCH
   ============================================================ */

function triggerSearch() {
  const query = DOM.searchInput.value.trim();

  if (!query) {
    DOM.searchInput.style.borderColor = "var(--accent)";
    setTimeout(() => { DOM.searchInput.style.borderColor = ""; }, 1200);
    return;
  }

  state.currentQuery = query;
  state.currentPage  = 1;
  DOM.catBtns.forEach((b) => b.classList.remove("active"));
  loadCurrentView();
}

DOM.searchBtn.addEventListener("click", triggerSearch);

DOM.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") triggerSearch();
});

// Debounced auto-search (500ms after user stops typing)
DOM.searchInput.addEventListener("input", () => {
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    const query = DOM.searchInput.value.trim();
    if (query.length >= 3) {
      state.currentQuery = query;
      state.currentPage  = 1;
      DOM.catBtns.forEach((b) => b.classList.remove("active"));
      loadCurrentView();
    }
  }, 500);
});

/* ============================================================
   12. RETRY
   ============================================================ */

DOM.retryBtn.addEventListener("click", () => {
  if (typeof state.lastRetryAction === "function") {
    state.lastRetryAction();
  }
});

/* ============================================================
   13. DARK MODE
   ============================================================ */

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  DOM.themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem("pulse_theme", theme);
}

DOM.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

function initTheme() {
  const saved = localStorage.getItem("pulse_theme");
  if (saved) {
    applyTheme(saved);
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }
}

/* ============================================================
   14. LOCAL STORAGE CACHE
   ============================================================ */

function saveToCache(articles) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ articles, savedAt: Date.now() }));
  } catch (e) {
    console.warn("Cache write failed:", e);
  }
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { articles, savedAt } = JSON.parse(raw);
    if (Date.now() - savedAt > 30 * 60 * 1000) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return articles;
  } catch {
    return null;
  }
}

/* ============================================================
   15. RESET / HOME
   ============================================================ */

function resetToHome() {
  state.currentQuery    = "";
  state.currentCategory = "general";
  state.currentPage     = 1;
  DOM.searchInput.value = "";

  DOM.catBtns.forEach((b) => b.classList.remove("active"));
  document.querySelector('[data-category="general"]')?.classList.add("active");

  loadCurrentView();
}

window.resetToHome = resetToHome;

/* ============================================================
   16. INIT
   ============================================================ */

async function init() {
  initTheme();

  const cached = loadFromCache();
  if (cached && cached.length > 0) {
    state.articles     = cached;
    state.totalResults = cached.length;
    renderNews(cached);
    DOM.sectionMeta.textContent = "(from cache — refreshing…)";

    try {
      const data = await fetchNews("", "general", 1);
      state.totalResults = data.totalResults || 0;
      state.articles     = data.articles || [];
      renderNews(state.articles);
      DOM.sectionMeta.textContent = `${state.totalResults.toLocaleString()} stories`;
      saveToCache(state.articles);
    } catch {
      DOM.sectionMeta.textContent = "(cached results)";
    }
  } else {
    await loadCurrentView();
  }
}

init();