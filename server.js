const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const { getConfig } = require("./src/config");
const { ScanStore } = require("./src/scanStore");
const { EbayLookup } = require("./src/ebayLookup");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const config = getConfig(rootDir);
const scanStore = new ScanStore({ config, dataDir: path.join(rootDir, "data") });
const ebayLookup = new EbayLookup(config);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders()
  });
  res.end(JSON.stringify(body));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": config.allowedOrigins || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/config") {
    sendJson(res, 200, config.publicConfig());
    return;
  }

  if (method === "GET" && pathname === "/api/get-scans") {
    sendJson(res, 200, { scans: await scanStore.listScans() });
    return;
  }

  if (method === "POST" && pathname === "/api/save-scan") {
    const scan = await scanStore.saveScan(await readJson(req));
    sendJson(res, 200, { scan });
    return;
  }

  if ((method === "GET" || method === "POST") && pathname === "/api/lookup-ebay") {
    const input = method === "POST" ? await readJson(req) : Object.fromEntries(url.searchParams.entries());
    sendJson(res, 200, await ebayLookup.lookup(input));
    return;
  }

  if (method === "POST" && pathname === "/api/lookup-ebay-image") {
    const input = await readJson(req);
    sendJson(res, 200, await ebayLookup.lookupImage(input));
    return;
  }

  if ((method === "GET" || method === "POST") && pathname === "/api/lookup-books") {
    const input = method === "POST" ? await readJson(req) : Object.fromEntries(url.searchParams.entries());
    sendJson(res, 200, await buildBookLookup(input));
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function buildBookLookup(input) {
  const query = cleanLookupQuery(input.title || input.query || "");
  const barcode = cleanLookupQuery(input.barcode || input.isbn || "");
  const isbn = barcode.replace(/[^0-9X]/gi, "");
  const result = {
    query,
    isbn,
    source: "url_builder",
    googleBooksUrl: `https://www.google.com/search?q=${encodeURIComponent((isbn || query) + " book")}`,
    openLibraryUrl: isbn ? `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}` : `https://openlibrary.org/search?q=${encodeURIComponent(query)}`,
    amazonUrl: `https://www.amazon.com/s?k=${encodeURIComponent(isbn || query)}`
  };
  if (!isbn) return result;
  try {
    const response = await fetch(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
    if (!response.ok) return result;
    const payload = await response.json();
    return {
      ...result,
      source: "open_library",
      title: payload.title || "",
      subtitle: payload.subtitle || "",
      publishDate: payload.publish_date || "",
      publishers: payload.publishers || []
    };
  } catch (error) {
    return { ...result, warning: error.message };
  }
}

function cleanLookupQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

async function serveFile(res, urlPath) {
  const routePath = urlPath === "/" || urlPath === "/scanner" ? "scanner.html" : String(urlPath || "").replace(/^\/+/, "");
  const resolved = path.normalize(path.join(publicDir, routePath));
  if (!resolved.startsWith(publicDir)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  try {
    const body = await fs.promises.readFile(resolved);
    const type = contentTypes[path.extname(resolved).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  } catch (error) {
    sendJson(res, 404, { error: "Not found" });
  }
}

async function handleRequest(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveFile(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(config.port, "0.0.0.0", () => {
    console.log(`Universal Spine Scanner running on port ${config.port}`);
  });
}

module.exports = { server };
