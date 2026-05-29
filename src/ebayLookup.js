class EbayLookup {
  constructor(config) {
    this.config = config;
    this.tokens = {};
  }

  async lookup(input) {
    const query = cleanLookupQuery(input.title || input.query || input.barcode || "");
    const encoded = encodeURIComponent(query);
    const activeUrl = `https://www.ebay.com/sch/i.html?_nkw=${encoded}`;
    const soldUrl = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Complete=1&LH_Sold=1`;
    let activeItems = [];
    let soldItems = [];
    const warnings = [];

    if (this.config.ebayConfigured && query) {
      try {
        activeItems = await this.searchActiveListings(query);
      } catch (error) {
        warnings.push(`Active lookup: ${error.message}`);
      }
      try {
        soldItems = await this.searchSoldItems(query);
      } catch (error) {
        warnings.push(`Sold lookup: ${error.message}`);
      }
    } else if (!this.config.ebayConfigured) {
      warnings.push("eBay API keys are not configured on the backend yet.");
    }

    const activePrices = activeItems.map(itemPrice).filter((price) => price > 0);
    const soldPrices = soldItems.map(itemPrice).filter((price) => price > 0);
    const estimatedPrice = median(soldPrices.length ? soldPrices : activePrices);
    const activeCount = activeItems.length;
    const soldCount = soldItems.length;
    const sellThroughRate = activeCount || soldCount
      ? Math.round((soldCount / Math.max(activeCount + soldCount, 1)) * 100)
      : null;

    return {
      query,
      source: soldItems.length ? "ebay_active_and_sold_samples" : activeItems.length ? "ebay_active_sample" : "url_builder",
      activeUrl,
      soldUrl,
      manualUrl: activeUrl,
      activeCount,
      soldCount,
      sellThroughRate,
      estimatedPrice,
      valueBucket: valueBucket(estimatedPrice),
      score: valueScore({ estimatedPrice, sellThroughRate }),
      resaleDecision: resaleDecision({ estimatedPrice, sellThroughRate, soldCount }),
      activeSample: summarizeLookupItems(activeItems),
      soldSample: summarizeLookupItems(soldItems),
      warnings,
      note: "Lookup runs through the backend. No private eBay keys are sent to the browser."
    };
  }

  async searchActiveListings(query) {
    const token = await this.getAppToken("https://api.ebay.com/oauth/api_scope");
    const url = new URL(`${this.config.ebayApiBaseUrl}/buy/browse/v1/item_summary/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "20");
    const payload = await ebayJson(url.toString(), {
      accessToken: token,
      marketplaceId: this.config.ebayMarketplaceId
    });
    return payload.itemSummaries || [];
  }

  async searchSoldItems(query) {
    const token = await this.getAppToken("https://api.ebay.com/oauth/api_scope/buy.marketplace.insights");
    const url = new URL(`${this.config.ebayApiBaseUrl}/buy/marketplace_insights/v1_beta/item_sales/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "20");
    const payload = await ebayJson(url.toString(), {
      accessToken: token,
      marketplaceId: this.config.ebayMarketplaceId
    });
    return payload.itemSales || payload.itemSummaries || [];
  }

  async getAppToken(scope) {
    const cached = this.tokens[scope];
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return cached.accessToken;
    }
    if (!this.config.ebayClientId || !this.config.ebayClientSecret) {
      throw new Error("eBay app keys are not configured");
    }
    const basic = Buffer.from(`${this.config.ebayClientId}:${this.config.ebayClientSecret}`).toString("base64");
    const response = await fetch(`${this.config.ebayApiBaseUrl}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error_description || payload.error || "eBay app token request failed");
    }
    this.tokens[scope] = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + Number(payload.expires_in || 0) * 1000
    };
    return this.tokens[scope].accessToken;
  }
}

async function ebayJson(url, options) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": options.marketplaceId
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.errors && payload.errors.length
      ? payload.errors.map((item) => item.message || item.longMessage).join("; ")
      : payload.error_description || payload.error || "eBay lookup failed";
    throw new Error(message);
  }
  return payload;
}

function summarizeLookupItems(items) {
  return (items || []).slice(0, 8).map((item) => ({
    title: item.title || "",
    price: itemPrice(item),
    url: item.itemWebUrl || item.itemAffiliateWebUrl || ""
  }));
}

function itemPrice(item) {
  const price = item && (item.price || item.itemPrice || item.lastSoldPrice || item.soldPrice);
  return Number(price && (price.value || price.convertedFromValue || price.amount) || 0);
}

function median(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : roundMoney((clean[middle - 1] + clean[middle]) / 2);
}

function valueBucket(price) {
  const value = Number(price || 0);
  if (value >= 50) return "over $50";
  if (value >= 20) return "over $20";
  if (value >= 10) return "over $10";
  return "under $10";
}

function resaleDecision(input) {
  const price = Number(input.estimatedPrice || 0);
  const rawRate = input.sellThroughRate;
  const rate = rawRate === null || rawRate === undefined ? null : Number(rawRate || 0);
  const soldCount = Number(input.soldCount || 0);
  const score = valueScore({ estimatedPrice: price, sellThroughRate: rawRate });
  if (score.color === "gold" || score.color === "green") return "worth listing";
  if (score.color === "red") return "skip";
  if (price >= 20 && rate >= 35) return "worth listing";
  if (price >= 10 && (rate >= 25 || soldCount >= 3)) return "review";
  if (price > 0 && price < 10) return "skip";
  return "review";
}

function valueScore(input) {
  const price = Number(input.estimatedPrice || 0);
  const rate = input.sellThroughRate === null || input.sellThroughRate === undefined
    ? null
    : Number(input.sellThroughRate || 0);
  if (!price || rate === null) {
    return {
      color: "unknown",
      label: "Needs live data",
      reason: "Connect backend eBay lookup for STR."
    };
  }
  if (rate >= 70 && price >= 50) {
    return { color: "gold", label: "Gold", reason: "STR above 70% and value above $50." };
  }
  if (rate >= 50 && price >= 20) {
    return { color: "green", label: "Green", reason: "STR above 50% and value above $20." };
  }
  if (rate > 10 && price >= 10) {
    return { color: "yellow", label: "Yellow", reason: "STR above 10% and value above $10." };
  }
  return { color: "red", label: "Red", reason: "STR below 10% or value below $10." };
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function cleanLookupQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

module.exports = { EbayLookup, valueBucket, resaleDecision, valueScore };
