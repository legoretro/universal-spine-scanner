class EbayLookup {
  constructor(config) {
    this.config = config;
    this.tokens = {};
  }

  async lookup(input) {
    const query = cleanLookupQuery(input.title || input.query || input.barcode || "");
    const itemType = cleanLookupQuery(input.itemType || input.type || "");
    const categoryIds = categoryIdsForItemType(itemType);
    const encoded = encodeURIComponent(query);
    const activeUrl = `https://www.ebay.com/sch/i.html?_nkw=${encoded}`;
    const soldUrl = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Complete=1&LH_Sold=1`;
    let activeItems = [];
    let soldItems = [];
    let activeTotal = 0;
    let soldTotal = 0;
    const warnings = [];

    if (this.config.ebayConfigured && query) {
      try {
        const active = await this.searchActiveListings(query, categoryIds);
        activeItems = active.items;
        activeTotal = active.total;
      } catch (error) {
        warnings.push(`Active lookup: ${error.message}`);
      }
      try {
        const sold = await this.searchSoldItems(query, categoryIds);
        soldItems = sold.items;
        soldTotal = sold.total;
      } catch (error) {
        try {
          const fallbackSold = await this.searchCompletedItems(query, categoryIds);
          soldItems = fallbackSold.items;
          soldTotal = fallbackSold.total;
          warnings.push("Sold lookup used eBay completed-items fallback.");
        } catch (fallbackError) {
          warnings.push(`Sold lookup: ${error.message}; completed-items fallback: ${fallbackError.message}`);
        }
      }
    } else if (!this.config.ebayConfigured) {
      warnings.push("eBay API keys are not configured on the backend yet.");
    }

    const activePrices = activeItems.map(itemPrice).filter((price) => price > 0);
    const soldPrices = soldItems.map(itemPrice).filter((price) => price > 0);
    const estimatedPrice = median(soldPrices.length ? soldPrices : activePrices);
    const activeCount = activeTotal || activeItems.length;
    const soldCount = soldTotal || soldItems.length;
    const sellThroughRate = activeCount || soldCount
      ? Math.round((soldCount / Math.max(activeCount + soldCount, 1)) * 100)
      : null;
    const suggestedTitle = suggestTitle(query, soldItems.concat(activeItems));

    return {
      query,
      itemType,
      categoryIds,
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
      suggestedTitle,
      activeSample: summarizeLookupItems(activeItems),
      soldSample: summarizeLookupItems(soldItems),
      sellerMemory: {
        found: false,
        reason: "Seller OAuth history is not connected yet."
      },
      warnings,
      note: "Lookup runs through the backend. No private eBay keys are sent to the browser."
    };
  }

  async lookupImage(input) {
    const image = cleanImagePayload(input.image || "");
    const itemType = cleanLookupQuery(input.itemType || input.type || "");
    const categoryIds = categoryIdsForItemType(itemType);
    const warnings = [];
    if (!image) {
      return {
        source: "image_missing",
        itemType,
        categoryIds,
        activeCount: 0,
        estimatedPrice: 0,
        suggestedTitle: "",
        activeSample: [],
        warnings: ["No image was sent for visual lookup."]
      };
    }
    if (!this.config.ebayConfigured) {
      return {
        source: "image_unconfigured",
        itemType,
        categoryIds,
        activeCount: 0,
        estimatedPrice: 0,
        suggestedTitle: "",
        activeSample: [],
        warnings: ["eBay API keys are not configured on the backend yet."]
      };
    }
    let activeItems = [];
    let activeTotal = 0;
    try {
      const active = await this.searchByImage(image, categoryIds);
      activeItems = active.items;
      activeTotal = active.total;
    } catch (error) {
      warnings.push(`Image lookup: ${error.message}`);
    }
    const activePrices = activeItems.map(itemPrice).filter((price) => price > 0);
    const suggestedTitle = cleanSuggestedTitle(activeItems[0] && activeItems[0].title || "");
    return {
      source: activeItems.length ? "ebay_image_search" : "image_no_match",
      itemType,
      categoryIds,
      activeCount: activeTotal || activeItems.length,
      soldCount: 0,
      sellThroughRate: null,
      estimatedPrice: median(activePrices),
      valueBucket: valueBucket(median(activePrices)),
      score: valueScore({ estimatedPrice: median(activePrices), sellThroughRate: null }),
      resaleDecision: "review",
      suggestedTitle,
      activeSample: summarizeLookupItems(activeItems),
      soldSample: [],
      warnings,
      note: "Visual lookup uses eBay Browse search_by_image through the backend."
    };
  }

  async searchActiveListings(query, categoryIds) {
    const token = await this.getAppToken("https://api.ebay.com/oauth/api_scope");
    const url = new URL(`${this.config.ebayApiBaseUrl}/buy/browse/v1/item_summary/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "30");
    if (categoryIds) {
      url.searchParams.set("category_ids", categoryIds);
    }
    const payload = await ebayJson(url.toString(), {
      accessToken: token,
      marketplaceId: this.config.ebayMarketplaceId
    });
    return {
      items: payload.itemSummaries || [],
      total: Number(payload.total || 0)
    };
  }

  async searchSoldItems(query, categoryIds) {
    const token = await this.getAppToken("https://api.ebay.com/oauth/api_scope/buy.marketplace.insights");
    const url = new URL(`${this.config.ebayApiBaseUrl}/buy/marketplace_insights/v1_beta/item_sales/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "30");
    if (categoryIds) {
      url.searchParams.set("category_ids", categoryIds);
    }
    const payload = await ebayJson(url.toString(), {
      accessToken: token,
      marketplaceId: this.config.ebayMarketplaceId
    });
    return {
      items: payload.itemSales || payload.itemSummaries || [],
      total: Number(payload.total || 0)
    };
  }

  async searchCompletedItems(query, categoryIds) {
    if (!this.config.ebayClientId) {
      throw new Error("eBay App ID is not configured");
    }
    const url = new URL("https://svcs.ebay.com/services/search/FindingService/v1");
    url.searchParams.set("OPERATION-NAME", "findCompletedItems");
    url.searchParams.set("SERVICE-VERSION", "1.13.0");
    url.searchParams.set("SECURITY-APPNAME", this.config.ebayClientId);
    url.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
    url.searchParams.set("REST-PAYLOAD", "");
    url.searchParams.set("GLOBAL-ID", marketplaceToGlobalId(this.config.ebayMarketplaceId));
    url.searchParams.set("keywords", query);
    url.searchParams.set("paginationInput.entriesPerPage", "30");
    url.searchParams.set("itemFilter(0).name", "SoldItemsOnly");
    url.searchParams.set("itemFilter(0).value", "true");
    if (categoryIds) {
      url.searchParams.set("categoryId", String(categoryIds).split(",")[0]);
    }
    const response = await fetch(url.toString());
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error("eBay completed-items request failed");
    }
    const body = payload.findCompletedItemsResponse && payload.findCompletedItemsResponse[0] || {};
    const ack = firstValue(body.ack);
    if (ack && ack.toLowerCase() === "failure") {
      const errors = body.errorMessage && body.errorMessage[0] && body.errorMessage[0].error || [];
      throw new Error(errors.map((item) => firstValue(item.message)).filter(Boolean).join("; ") || "eBay completed-items lookup failed");
    }
    const searchResult = body.searchResult && body.searchResult[0] || {};
    const pagination = body.paginationOutput && body.paginationOutput[0] || {};
    return {
      items: normalizeFindingItems(searchResult.item || []),
      total: Number(firstValue(pagination.totalEntries) || 0)
    };
  }

  async searchByImage(base64Image, categoryIds) {
    const token = await this.getAppToken("https://api.ebay.com/oauth/api_scope");
    const url = new URL(`${this.config.ebayApiBaseUrl}/buy/browse/v1/item_summary/search_by_image`);
    url.searchParams.set("limit", "12");
    if (categoryIds) {
      url.searchParams.set("category_ids", String(categoryIds).split(",")[0]);
    }
    const payload = await ebayJson(url.toString(), {
      method: "POST",
      accessToken: token,
      marketplaceId: this.config.ebayMarketplaceId,
      body: JSON.stringify({ image: base64Image })
    });
    return {
      items: payload.itemSummaries || [],
      total: Number(payload.total || 0)
    };
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
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": options.marketplaceId
    },
    body: options.body
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

function normalizeFindingItems(items) {
  return (items || []).map((item) => ({
    title: firstValue(item.title),
    price: { value: firstValue(item.sellingStatus && item.sellingStatus[0] && item.sellingStatus[0].currentPrice && item.sellingStatus[0].currentPrice[0] && item.sellingStatus[0].currentPrice[0].__value__) },
    itemWebUrl: firstValue(item.viewItemURL)
  }));
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value || "";
}

function suggestTitle(query, items) {
  const queryKey = titleKey(query);
  if (!queryKey || !items.length) return "";
  const best = items
    .map((item) => {
      const title = item.title || "";
      return { title, score: titleSimilarity(queryKey, titleKey(title)) };
    })
    .filter((item) => item.title && item.score >= 0.18)
    .sort((a, b) => b.score - a.score)[0];
  return best ? cleanSuggestedTitle(best.title) : "";
}

function categoryIdsForItemType(itemType) {
  const type = String(itemType || "").toLowerCase();
  if (type === "vhs") return "309";
  if (type === "dvd" || type === "blu-ray" || type === "blu ray" || type === "movie" || type === "movies") return "617";
  if (type === "game" || type === "video game") return "139973";
  if (type === "cd" || type === "cassette") return "176984";
  return "";
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

function cleanImagePayload(value) {
  return String(value || "")
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "")
    .replace(/\s+/g, "")
    .trim();
}

function marketplaceToGlobalId(marketplaceId) {
  if (String(marketplaceId || "").toUpperCase() === "EBAY_US") return "EBAY-US";
  return "EBAY-US";
}

function cleanSuggestedTitle(value) {
  const raw = cleanLookupQuery(value);
  if (/\b(lot|bundle|assorted|various|wholesale|disc lot|movie lot|dvd movie lot|collection)\b/i.test(raw)) {
    return "";
  }
  return raw
    .replace(/\b(new|used|sealed|tested|working|rare|vhs|dvd|blu[- ]?ray|movie|video|tape|disc)\b/gi, " ")
    .replace(/\b(black diamond|clamshell|walt disney|disney|home video|family feature)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function titleKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|a|an|and|of|for|with|vhs|dvd|blu|ray|movie|video|tape|disc|new|used)\b/g, " ")
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

module.exports = { EbayLookup, valueBucket, resaleDecision, valueScore };
