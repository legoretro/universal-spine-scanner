const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

class ScanStore {
  constructor(options) {
    this.config = options.config;
    this.dataDir = options.dataDir;
    this.localPath = path.join(this.dataDir, "spine-scans.json");
  }

  async listScans() {
    if (this.config.supabaseConfigured) {
      return this.listSupabaseScans();
    }
    return this.listLocalScans();
  }

  async saveScan(input) {
    const now = new Date().toISOString();
    const scan = normalizeScan({
      ...input,
      id: input.id || crypto.randomUUID(),
      createdAt: input.createdAt || now,
      updatedAt: now
    });
    if (this.config.supabaseConfigured) {
      await this.saveSupabaseScan(scan);
      return scan;
    }
    const scans = await this.listLocalScans();
    const index = scans.findIndex((item) => item.id === scan.id);
    if (index === -1) scans.unshift(scan);
    else scans[index] = scan;
    await this.writeLocalScans(scans);
    return scan;
  }

  async listSupabaseScans() {
    const url = new URL(`${cleanSupabaseUrl(this.config.supabaseUrl)}/rest/v1/${encodeURIComponent(this.config.supabaseScansTable)}`);
    url.searchParams.set("select", "scan_data");
    url.searchParams.set("order", "updated_at.desc");
    url.searchParams.set("limit", "1000");
    const rows = await supabaseJson(url.toString(), this.config);
    return rows.map((row) => normalizeScan(row.scan_data || {})).sort(sortNewestFirst);
  }

  async saveSupabaseScan(scan) {
    const url = `${cleanSupabaseUrl(this.config.supabaseUrl)}/rest/v1/${encodeURIComponent(this.config.supabaseScansTable)}`;
    await supabaseJson(url, this.config, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        id: scan.id,
        title: scan.title,
        item_type: scan.itemType,
        decision: scan.decision,
        value_bucket: scan.valueBucket,
        estimated_price: scan.estimatedPrice,
        scan_data: scan,
        created_at: scan.createdAt,
        updated_at: scan.updatedAt
      })
    });
  }

  async listLocalScans() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const scans = JSON.parse(await fs.readFile(this.localPath, "utf8"));
      return Array.isArray(scans) ? scans.map(normalizeScan).sort(sortNewestFirst) : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeLocalScans(scans) {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.localPath, JSON.stringify(scans.map(normalizeScan).sort(sortNewestFirst), null, 2));
  }
}

async function supabaseJson(url, config, options) {
  const response = await fetch(url, {
    method: options && options.method || "GET",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      ...(options && options.headers || {})
    },
    body: options && options.body
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body && body.message || "Supabase request failed");
  }
  return body || [];
}

function normalizeScan(input) {
  return {
    id: cleanString(input.id),
    title: cleanString(input.title),
    itemType: cleanString(input.itemType || input.item_type || "Other"),
    subtitle: cleanString(input.subtitle),
    barcode: cleanString(input.barcode),
    condition: cleanString(input.condition || "used"),
    sealed: cleanString(input.sealed || "open"),
    notes: cleanString(input.notes),
    imageName: cleanString(input.imageName),
    lookupStatus: cleanString(input.lookupStatus || "not looked up"),
    decision: cleanDecision(input.decision),
    estimatedPrice: cleanNumber(input.estimatedPrice),
    sellThroughRate: input.sellThroughRate === null || input.sellThroughRate === undefined ? null : cleanNumber(input.sellThroughRate),
    activeCount: cleanNumber(input.activeCount),
    soldCount: cleanNumber(input.soldCount),
    valueBucket: cleanBucket(input.valueBucket || bucketForPrice(input.estimatedPrice)),
    ocrRaw: cleanString(input.ocrRaw),
    createdAt: cleanString(input.createdAt),
    updatedAt: cleanString(input.updatedAt)
  };
}

function cleanSupabaseUrl(value) {
  return String(value || "").replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

function cleanString(value) {
  return String(value || "").trim().slice(0, 3000);
}

function cleanNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function cleanDecision(value) {
  const clean = cleanString(value || "scanned");
  return ["scanned", "review", "worth listing", "skip", "listed"].includes(clean) ? clean : "scanned";
}

function bucketForPrice(price) {
  const value = cleanNumber(price);
  if (value >= 50) return "over $50";
  if (value >= 20) return "over $20";
  if (value >= 10) return "over $10";
  return "under $10";
}

function cleanBucket(value) {
  const clean = cleanString(value);
  return ["under $10", "over $10", "over $20", "over $50"].includes(clean) ? clean : bucketForPrice(0);
}

function sortNewestFirst(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
}

module.exports = { ScanStore, normalizeScan };
