/* ============================================================
   PULSE NEWS APP — script.js
   API: NewsData.io — CORS allowed on deployed sites ✅
   Free plan: 200 requests/day
   ============================================================ */

"use strict";

/* ============================================================
   1. CONFIGURATION
   ============================================================ */

// 🔑 NewsData.io API key
const API_KEY  = "pub_8e4f2f86438b495a9fa3be161518afb5";
const BASE_URL = "https://newsdata.io/api/1";

const PAGE_SIZE = 9;
const PLACEHOLDER_IMG = "https://placehold.co/600x400/1A1A1A/9A9590?text=No+Image";
const CACHE_KEY = "pulse_news_cache";

/* ============================================================
   2. CATEGORY MAP
   NewsData.io category names
   ============================================================ */
const CATEGORY_MAP = {
  general:       "top",
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
  currentPage:     1,       // NewsData uses cursor-based pagination (nextPage token)
  nextPageToken:   null,    // NewsData returns a `nextPage` string token
  prevPageTokens:  [],      // stack to go back
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
   5. API — NewsData.io
   
   Response shape:
   {
     status: "success",
     totalResults: number,
     results: [{ title, description, link, image_url, pubDate, source_name, ... }],
     nextPage: "token_string" | null
   }
   ============================================================ */
async function fetchNews(query = "", category = "general", pageToken = null) {
  let url;
  const cat = CATEGORY_MAP[category] || "top";

  if (query.trim()) {
    // Search mode — /news endpoint with q param
    url = `${BASE_URL}/news?q=${encodeURIComponent(query)}&language=en&apikey=${API_KEY}`;
  } else {
    // Category / latest news mode
    url = `${BASE_URL}/news?category=${cat}&language=en&apikey=${API_KEY}`;
  }

  // NewsData uses cursor-based pagination via `page` token
  if (pageToken) {
    url += `&page=${pageToken}`;
  }

  const response = await fetch(url);

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.results?.message || `Request failed (${response.status})`);
  }

  const data = await response.json();

  if (data.status !== "success") {
    throw new Error(data.results?.message || "API returned an error");
  }

  // Normalize to our standard shape
  const normalized = (data.results || []).map((a) => ({
    title:       a.title,
    description: a.description,
    url:         a.link,
    urlToImage:  a.image_url,
    publishedAt: a.pubDate,
    source:      { name: a.source_name || a.source_id || "Unknown" },
  })).filter(a => a.title && a.title !== "[Removed]");

  return {
    status:        "ok",
    articles:      normalized,
    totalResults:  data.totalResults || normalized.length,
    nextPageToken: data.nextPage || null,
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
  DOM.errorMsg.textContent = message;
  DOM.errorWrap.hidden     = false;
  DOM.newsGrid.hidden      = true;
  DOM.pagination.hidden    = true;
  state.lastRetryAction    = retryFn;
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
  if (!title) return null;

  const card     = document.createElement("article");
  card.className = "news-card";

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
   NewsData uses cursor tokens, not page numbers.
   We maintain a stack of previous tokens to go back.
   ============================================================ */

function updatePagination() {
  const hasNext = !!state.nextPageToken;
  const hasPrev = state.prevPageTokens.length > 0;

  if (!hasNext && !hasPrev) {
    DOM.pagination.hidden = true;
    return;
  }

  DOM.pagination.hidden    = false;
  DOM.pageInfo.textContent = `Page ${state.currentPage}`;
  DOM.prevBtn.disabled     = !hasPrev;
  DOM.nextBtn.disabled     = !hasNext;
}

// Next page — use the nextPageToken
DOM.nextBtn.addEventListener("click", () => {
  if (!state.nextPageToken) return;
  // Push current token to stack so we can go back
  state.prevPageTokens.push(state.currentTokenUsed || null);
  state.currentPage++;
  loadCurrentView(state.nextPageToken);
});

// Previous page — pop from stack
DOM.prevBtn.addEventListener("click", () => {
  if (state.prevPageTokens.length === 0) return;
  const prevToken = state.prevPageTokens.pop();
  state.currentPage--;
  loadCurrentView(prevToken);
});

/* ============================================================
   9. CORE LOAD
   ============================================================ */

async function loadCurrentView(pageToken = null) {
  showLoader();

  // Track which token we used for this load
  state.currentTokenUsed = pageToken;

  if (state.currentQuery.trim()) {
    DOM.sectionTitle.textContent = `Results for "${state.currentQuery}"`;
  } else {
    const catLabel = document.querySelector(".cat-btn.active")?.textContent || "Top Stories";
    DOM.sectionTitle.textContent = catLabel;
  }

  try {
    const data = await fetchNews(state.currentQuery, state.currentCategory, pageToken);

    state.totalResults  = data.totalResults || 0;
    state.articles      = data.articles || [];
    state.nextPageToken = data.nextPageToken || null;

    DOM.sectionMeta.textContent = state.totalResults
      ? `${state.totalResults.toLocaleString()} stories`
      : "";

    renderNews(state.articles);
    saveToCache(state.articles);
    window.scrollTo({ top: 120, behavior: "smooth" });

  } catch (err) {
    const cached = loadFromCache();
    if (cached && !pageToken && !state.currentQuery) {
      renderNews(cached);
      DOM.sectionMeta.textContent = "(showing cached results)";
    } else {
      showError(err.message || "Network error. Check your connection.", () => loadCurrentView(pageToken));
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

    state.currentCategory  = btn.dataset.category;
    state.currentQuery     = "";
    state.currentPage      = 1;
    state.nextPageToken    = null;
    state.prevPageTokens   = [];
    DOM.searchInput.value  = "";

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

  state.currentQuery   = query;
  state.currentPage    = 1;
  state.nextPageToken  = null;
  state.prevPageTokens = [];
  DOM.catBtns.forEach((b) => b.classList.remove("active"));
  loadCurrentView();
}

DOM.searchBtn.addEventListener("click", triggerSearch);

DOM.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") triggerSearch();
});

// Debounced auto-search (500ms)
DOM.searchInput.addEventListener("input", () => {
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    const query = DOM.searchInput.value.trim();
    if (query.length >= 3) {
      state.currentQuery   = query;
      state.currentPage    = 1;
      state.nextPageToken  = null;
      state.prevPageTokens = [];
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
    applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
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
  state.nextPageToken   = null;
  state.prevPageTokens  = [];
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
    state.articles = cached;
    renderNews(cached);
    DOM.sectionMeta.textContent = "(from cache — refreshing…)";

    try {
      const data = await fetchNews("", "general", null);
      state.articles      = data.articles || [];
      state.nextPageToken = data.nextPageToken || null;
      renderNews(state.articles);
      DOM.sectionMeta.textContent = `${(data.totalResults || 0).toLocaleString()} stories`;
      saveToCache(state.articles);
    } catch {
      DOM.sectionMeta.textContent = "(cached results)";
    }
  } else {
    await loadCurrentView();
  }
}

init();