class SellerMemoryStore {
  constructor(config) {
    this.config = config || {};
  }

  async findBest(input) {
    if (!this.isConfigured()) {
      return {
        found: false,
        reason: "Seller memory is not synced to Supabase yet."
      };
    }
    const title = cleanString(input.title || input.query || "");
    const key = titleKey(title);
    if (!key) {
      return {
        found: false,
        reason: "No title to check against seller memory."
      };
    }
    const rows = await this.searchRows(key);
    const matches = rows
      .map((row) => {
        const record = normalizeMemory(row.memory_data || row);
        return {
          record,
          score: titleSimilarity(key, record.titleKey || titleKey(record.title))
        };
      })
      .filter((item) => item.score >= 0.42)
      .sort((a, b) => b.score - a.score || new Date(b.record.soldAt || 0) - new Date(a.record.soldAt || 0));
    const best = matches[0];
    if (!best) {
      return {
        found: false,
        reason: "No matching seller memory yet."
      };
    }
    return {
      found: true,
      title: best.record.title,
      soldPrice: best.record.soldPrice,
      soldDate: best.record.soldAt,
      daysToSell: best.record.daysToSell,
      itemType: best.record.itemType,
      sku: best.record.sku,
      matchScore: Math.round(best.score * 100)
    };
  }

  async searchRows(key) {
    const url = new URL(`${cleanSupabaseUrl(this.config.supabaseUrl)}/rest/v1/${encodeURIComponent(this.config.supabaseSoldMemoryTable)}`);
    url.searchParams.set("select", "memory_data,title,title_key,sold_price,sold_at");
    url.searchParams.set("or", tokenSearchFilter(key));
    url.searchParams.set("order", "sold_at.desc");
    url.searchParams.set("limit", "25");
    return supabaseJson(url.toString(), this.config);
  }

  isConfigured() {
    return Boolean(this.config.supabaseUrl && this.config.supabaseServiceRoleKey && this.config.supabaseSoldMemoryTable);
  }
}

async function supabaseJson(url, config) {
  const response = await fetch(url, {
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "Content-Type": "application/json"
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body && (body.message || body.error) || "Supabase seller memory request failed");
  }
  return body || [];
}

function tokenSearchFilter(key) {
  const tokens = key.split(" ").filter((word) => word.length > 2).slice(0, 4);
  if (!tokens.length) {
    return `(title_key.ilike.*${escapeLikeToken(key)}*)`;
  }
  return `(${tokens.map((token) => `title_key.ilike.*${escapeLikeToken(token)}*`).join(",")})`;
}

function escapeLikeToken(value) {
  return encodeURIComponent(String(value || "").replace(/[%*,()]/g, ""));
}

function normalizeMemory(input) {
  return {
    title: cleanString(input.title),
    titleKey: cleanString(input.titleKey || input.title_key || titleKey(input.title)),
    itemType: cleanString(input.itemType || input.item_type),
    sku: cleanString(input.sku),
    soldPrice: Number(input.soldPrice || input.sold_price || 0),
    soldAt: cleanString(input.soldAt || input.sold_at),
    daysToSell: input.daysToSell === null || input.daysToSell === undefined ? null : Number(input.daysToSell)
  };
}

function titleKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|a|an|and|of|for|with|vhs|dvd|blu|ray|movie|video|tape|disc|new|used|special|edition)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftWords = left.split(" ").filter((word) => word.length > 2);
  const rightWords = new Set(right.split(" ").filter((word) => word.length > 2));
  if (!leftWords.length || !rightWords.size) return 0;
  const hits = leftWords.reduce((count, word) => count + (rightWords.has(word) ? 1 : 0), 0);
  return hits / Math.max(leftWords.length, rightWords.size);
}

function cleanSupabaseUrl(value) {
  return String(value || "").replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

function cleanString(value) {
  return String(value || "").trim().slice(0, 3000);
}

module.exports = { SellerMemoryStore };
