/**
 * Reading interface.
 * The browser never edits notes. It asks the local server for a catalog,
 * then for one article at a time, and draws them like a small encyclopedia.
 */
const canvas = document.getElementById("canvas");
const sidebar = document.getElementById("sidebar");
const searchInput = document.getElementById("search");
const countEl = document.getElementById("count");
const shelvesToggle = document.getElementById("shelves-toggle");

let library = { shelves: [], articles: [] };
let query = "";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function articleHref(id) {
  return `#/a/${encodeURIComponent(id)}`;
}

function currentId() {
  const hash = location.hash || "";
  if (!hash.startsWith("#/a/")) return "";
  return decodeURIComponent(hash.slice(4));
}

function matches(article, q) {
  if (!q) return true;
  const haystack = [
    article.title,
    article.category,
    article.rel,
    article.excerpt,
    ...(article.tags || []),
    ...(article.aliases || []),
  ].join(" ").toLowerCase();
  return haystack.includes(q);
}

function visibleArticles() {
  const q = query.trim().toLowerCase();
  return library.articles.filter((article) => matches(article, q));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderSidebar(activeId) {
  const articles = visibleArticles();
  const byShelf = new Map(library.shelves.map((name) => [name, []]));
  for (const article of articles) {
    if (!byShelf.has(article.category)) byShelf.set(article.category, []);
    byShelf.get(article.category).push(article);
  }

  const shelves = [...byShelf.keys()].sort((a, b) => a.localeCompare(b));
  sidebar.innerHTML = shelves.map((name) => {
    const items = byShelf.get(name);
    const list = items.length
      ? `<ul>${items.map((article) => `
          <li><a class="${article.id === activeId ? "active" : ""}" href="${articleHref(article.id)}">${esc(article.title)}</a></li>
        `).join("")}</ul>`
      : `<p class="empty">No notes yet</p>`;
    return `<section class="shelf"><h2 class="shelf-name">${esc(name)}</h2>${list}</section>`;
  }).join("");
}

function renderCatalog() {
  const articles = visibleArticles();
  document.title = query ? `Search: ${query} — Efforts Wiki` : "Efforts Wiki";
  renderSidebar("");

  const groups = new Map();
  for (const article of articles) {
    if (!groups.has(article.category)) groups.set(article.category, []);
    groups.get(article.category).push(article);
  }

  const lead = query
    ? `${articles.length} ${articles.length === 1 ? "article" : "articles"} matching “${esc(query)}”.`
    : "A reading shelf for notes filed under 10 Efforts. Choose an article, or search the titles, tags, and opening lines.";

  const body = articles.length
    ? [...groups.keys()].sort((a, b) => a.localeCompare(b)).map((name) => `
        <section class="group">
          <h2>${esc(name)}</h2>
          ${groups.get(name).map((article) => `
            <article class="entry">
              <a class="entry-title" href="${articleHref(article.id)}">${esc(article.title)}</a>
              ${article.excerpt ? `<p>${esc(article.excerpt)}</p>` : ""}
            </article>
          `).join("")}
        </section>
      `).join("")
    : `<p class="notice">${query ? "No articles match that search." : "This shelf is empty. Add a Markdown note to any folder in 10 Efforts and refresh."}</p>`;

  canvas.innerHTML = `
    <div class="paper catalog">
      <p class="kicker">Contents</p>
      <h1>${query ? "Search" : "Efforts Wiki"}</h1>
      <p class="catalog-lead">${lead}</p>
      ${body}
    </div>
  `;
}

async function renderArticle(id) {
  renderSidebar(id);
  canvas.innerHTML = `<p class="loading">Opening article…</p>`;
  const response = await fetch(`/api/article?id=${encodeURIComponent(id)}`);
  if (!response.ok) {
    canvas.innerHTML = `<div class="paper"><p class="notice">That article is not in the library.</p></div>`;
    return;
  }
  const article = await response.json();
  document.title = `${article.title} — Efforts Wiki`;

  const bits = [
    article.category ? `<span>${esc(article.category)}</span>` : "",
    article.date ? `<span>${esc(formatDate(article.date))}</span>` : "",
    article.tags?.length ? `<span>${article.tags.map(esc).join(", ")}</span>` : "",
  ].filter(Boolean).join("");

  const backlinks = article.backlinks?.length
    ? `<section class="backlinks"><h2>What links here</h2><ul>${article.backlinks.map((item) =>
        `<li><a href="${articleHref(item.id)}">${esc(item.title)}</a></li>`
      ).join("")}</ul></section>`
    : "";

  canvas.innerHTML = `
    <article class="paper">
      <p class="kicker"><a href="#/">Contents</a> / ${esc(article.category)}</p>
      <div class="article">
        <h1>${esc(article.title)}</h1>
        ${bits ? `<p class="meta">${bits}</p>` : ""}
        ${article.html}
        ${backlinks}
      </div>
    </article>
  `;
  canvas.scrollTop = 0;
  window.scrollTo(0, 0);
}

async function load() {
  const response = await fetch("/api/catalog");
  library = await response.json();
  const n = library.articles.length;
  countEl.textContent = `${n} ${n === 1 ? "article" : "articles"}`;
  route();
}

function route() {
  const id = currentId();
  if (id) renderArticle(id);
  else renderCatalog();
  document.body.classList.remove("show-shelves");
  shelvesToggle.setAttribute("aria-expanded", "false");
}

searchInput.addEventListener("input", () => {
  query = searchInput.value;
  if (currentId()) history.pushState(null, "", "#/");
  renderCatalog();
});

document.getElementById("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
});

shelvesToggle.addEventListener("click", () => {
  const open = document.body.classList.toggle("show-shelves");
  shelvesToggle.setAttribute("aria-expanded", open ? "true" : "false");
});

window.addEventListener("hashchange", route);

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== searchInput) {
    event.preventDefault();
    searchInput.focus();
  }
});

load().catch(() => {
  canvas.innerHTML = `<p class="notice">The library server did not answer. Start it with npm start in Wiki_notes_on_the_go.</p>`;
});
