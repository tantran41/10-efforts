/**
 * Local reading server for the Efforts wiki.
 *
 * It does not store a second copy of your notes. Every request walks the
 * parent folder (10 EFFORTS) and reads the Markdown files that are already there.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The wiki app lives inside 10 EFFORTS. Notes live in the sibling folders.
const LIBRARY = path.resolve(__dirname, "..");
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 4321);

const SKIP_DIRS = new Set(["node_modules", ".git", ".obsidian"]);

marked.setOptions({
  gfm: true,
  breaks: false,
});

function walk(dir, rel, files) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const nextRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      // The app folder is not a shelf of notes.
      if (path.resolve(abs) === __dirname) continue;
      walk(abs, nextRel, files);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push({ abs, rel: nextRel.split(path.sep).join("/") });
    }
  }
}

function listMarkdown() {
  const files = [];
  walk(LIBRARY, "", files);
  return files;
}

function topFolder(rel) {
  const parts = rel.split("/");
  if (parts.length < 2) return "Library";
  return parts[0];
}

function titleFrom(body, filename) {
  const heading = body.match(/^#{1,2}\s+(.+)$/m);
  if (heading) {
    // Drop emphasis markers, but keep underscores. This vault uses them in titles.
    return heading[1].replace(/[*`]/g, "").trim();
  }
  return filename.replace(/\.md$/i, "");
}

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function excerptOf(body) {
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/[#>*_`\-\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 280);
}

function normalizeOutline(markdown) {
  // Some notes write headings as list items: "- # Title".
  // Turn those into real headings so they render as sections.
  return markdown.replace(/^[ \t]*-[ \t]+(#{1,6}\s+.+)$/gm, "$1");
}

function loadNote(file) {
  const raw = fs.readFileSync(file.abs, "utf8");
  const parsed = matter(raw);
  const body = normalizeOutline(parsed.content || "");
  const stem = path.basename(file.rel, ".md");
  const data = parsed.data || {};
  return {
    id: file.rel,
    title: titleFrom(body, stem),
    stem,
    category: topFolder(file.rel),
    rel: file.rel,
    tags: asList(data.tags).filter((tag) => tag && tag !== "null"),
    aliases: asList(data.aliases).filter(Boolean),
    date: data.date || data.created || data.lastmod || "",
    body,
    excerpt: excerptOf(body),
  };
}

function catalog() {
  return listMarkdown()
    .map((file) => {
      try {
        const note = loadNote(file);
        return {
          id: note.id,
          title: note.title,
          stem: note.stem,
          category: note.category,
          rel: note.rel,
          tags: note.tags,
          aliases: note.aliases,
          date: String(note.date || ""),
          excerpt: note.excerpt,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));
}

function shelves() {
  const names = new Set(["Library"]);
  let entries = [];
  try {
    entries = fs.readdirSync(LIBRARY, { withFileTypes: true });
  } catch {
    return ["Library"];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    if (entry.name === path.basename(__dirname)) continue;
    names.add(entry.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function resolveTarget(target, notes) {
  const want = target.trim().replace(/\\/g, "/").replace(/\.md$/i, "");
  const lower = want.toLowerCase();
  const base = path.posix.basename(want).toLowerCase();
  return (
    notes.find((note) => note.rel.replace(/\.md$/i, "").toLowerCase() === lower) ||
    notes.find((note) => note.stem.toLowerCase() === base) ||
    notes.find((note) => note.title.toLowerCase() === base) ||
    notes.find((note) => note.aliases.some((alias) => alias.toLowerCase() === base)) ||
    null
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkify(markdown, notes) {
  // Embeds ![[Note]] become the same kind of cross-link as [[Note]].
  const withEmbeds = markdown.replace(/!\[\[([^\]]+)\]\]/g, "[[$1]]");
  return withEmbeds.replace(/\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, _hash, label) => {
    const note = resolveTarget(target, notes);
    const text = (label || target).trim();
    if (!note) {
      return `<a class="wiki-missing">${escapeHtml(text)}</a>`;
    }
    const href = `#/a/${encodeURIComponent(note.id)}`;
    return `<a class="wiki-link" href="${href}">${escapeHtml(text)}</a>`;
  });
}

function renderArticle(id) {
  const notes = listMarkdown().map((file) => {
    try {
      return loadNote(file);
    } catch {
      return null;
    }
  }).filter(Boolean);

  const note = notes.find((item) => item.id === id);
  if (!note) return null;

  // The page already shows the title, so drop a leading Markdown heading.
  const withoutTitle = note.body.replace(/^\s*#{1,6}\s+[^\n]+\n*/, "");
  const linked = linkify(withoutTitle, notes);
  const html = marked.parse(linked);
  const names = [note.stem, note.title, ...note.aliases]
    .map((name) => name.toLowerCase())
    .filter(Boolean);
  const backlinks = notes
    .filter((other) => {
      if (other.id === note.id) return false;
      const body = other.body.toLowerCase();
      return names.some((name) => body.includes(`[[${name}`));
    })
    .map((other) => ({ id: other.id, title: other.title, category: other.category }));

  return {
    id: note.id,
    title: note.title,
    category: note.category,
    rel: note.rel,
    tags: note.tags,
    date: String(note.date || ""),
    html,
    backlinks,
  };
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/api/catalog") {
    sendJson(res, 200, { library: "10 EFFORTS", shelves: shelves(), articles: catalog() });
    return;
  }

  if (url.pathname === "/api/article") {
    const id = url.searchParams.get("id") || "";
    if (id.includes("..")) {
      sendJson(res, 400, { error: "Bad article id" });
      return;
    }
    const article = renderArticle(id);
    if (!article) {
      sendJson(res, 404, { error: "Article not found" });
      return;
    }
    sendJson(res, 200, article);
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(PUBLIC, "." + requested);
  if (!filePath.startsWith(PUBLIC)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  const ext = path.extname(filePath);
  send(res, 200, fs.readFileSync(filePath), TYPES[ext] || "application/octet-stream");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Efforts wiki  http://127.0.0.1:${PORT}`);
  console.log(`Reading notes from  ${LIBRARY}`);
});
