async function scanStackWithOpenAI(input, config, services) {
  if (!config.openaiApiKey) return null;

  const imageUrl = await buildImageDataUrl(input.image || "");
  const itemType = cleanText(input.itemType || input.type || "Other").slice(0, 40) || "Other";
  const itemCount = clampNumber(input.itemCount || input.count, 0, 40);
  const prompt = buildPrompt({ itemType, itemCount });
  const payload = await requestOpenAI({
    apiKey: config.openaiApiKey,
    model: config.openaiVisionModel || "gpt-4.1-mini",
    prompt,
    imageUrl
  });
  const parsed = parseOpenAIJson(payload);
  const detected = normalizeItems(parsed, itemCount);
  if (!detected.length) {
    throw new Error("Vision scan did not find readable spine titles.");
  }

  const items = await mapLimit(detected, 3, async (item) => {
    const title = cleanTitleForLookup(item.title);
    const usableTitle = isUsableTitle(title);
    const lookup = usableTitle && services && services.lookup
      ? await services.lookup(title, itemType).catch((error) => ({
        error: error.message,
        query: title,
        source: "lookup_failed"
      }))
      : null;
    const lookupQuality = lookupConfidence(title, lookup);
    const confidence = clamp01(item.confidence);
    const needsRescan = item.needsRescan
      || !usableTitle
      || confidence < 0.58
      || (!lookupHasData(lookup) && confidence < 0.72)
      || (lookupHasData(lookup) && lookupQuality < 0.18 && confidence < 0.82);

    return {
      index: item.index,
      title: title || `Unclear spine ${item.index}`,
      rawText: item.notes || "",
      confidence: Math.round(confidence * 100),
      titleStrength: roundNumber(confidence, 2),
      titleSource: "openai_vision",
      needsRescan,
      source: "openai_vision",
      lookup,
      candidates: [title].filter(Boolean)
    };
  });

  return {
    source: "openai_vision",
    itemType,
    itemCount: items.length,
    imageProcessed: true,
    note: "Image was read by the backend vision scanner and not stored by this route.",
    items
  };
}

async function buildImageDataUrl(value) {
  const base64 = cleanImagePayload(value);
  if (!base64) throw new Error("No image was sent");
  const sharp = optionalRequire("sharp");
  if (!sharp) return `data:image/jpeg;base64,${base64}`;
  const buffer = Buffer.from(base64, "base64");
  const resized = await sharp(buffer)
    .rotate()
    .resize({
      width: 1800,
      height: 2400,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({ quality: 86 })
    .toBuffer();
  return `data:image/jpeg;base64,${resized.toString("base64")}`;
}

async function requestOpenAI({ apiKey, model, prompt, imageUrl }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageUrl, detail: "high" }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "spine_stack_scan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    index: { type: "integer" },
                    title: { type: "string" },
                    itemType: { type: "string" },
                    confidence: { type: "number" },
                    needsRescan: { type: "boolean" },
                    notes: { type: "string" }
                  },
                  required: ["index", "title", "itemType", "confidence", "needsRescan", "notes"]
                }
              }
            },
            required: ["summary", "items"]
          }
        }
      },
      max_output_tokens: 2200,
      store: false
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error && payload.error.message || payload.error || "OpenAI vision request failed";
    throw new Error(message);
  }
  return payload;
}

function buildPrompt({ itemType, itemCount }) {
  const countLine = itemCount
    ? `Expected visible items: ${itemCount}. Return exactly ${itemCount} rows. Use "Unclear spine N" only if that row is unreadable.`
    : "Expected visible items: unknown. Return one row per readable spine.";
  return [
    "You are helping a reseller read thrift-store item spines from one photo.",
    "Read the visible title/name on each spine, ordered from top to bottom. If the stack is vertical, order left to right.",
    "Handle VHS, DVD, Blu-ray, books, games, CDs, cassettes, boxed media, and similar resale items.",
    "Ignore logos, format words, ratings, UPCs, price stickers, condition, and words like DVD, VHS, Blu-ray, Family Feature, Home Video, Special Edition, Hi-Fi, Stereo, Closed Captioned.",
    "Do not invent a title from a random object. You may use common title knowledge only to fix obvious OCR-style mistakes.",
    "Keep sequel numbers, season names, subtitles, and edition names when visible.",
    "Return clean resale search titles, not full descriptions.",
    `Broad item type selected by the user: ${itemType}.`,
    countLine,
    "Confidence guide: 0.90+ means clearly readable; 0.70 means probably correct; below 0.60 means needs rescan.",
    "Return JSON only."
  ].join("\n");
}

function parseOpenAIJson(payload) {
  const text = outputText(payload).trim();
  if (!text) throw new Error("Vision scan returned no text");
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Vision scan returned unreadable JSON");
  }
}

function outputText(payload) {
  if (payload.output_text) return payload.output_text;
  const chunks = [];
  (payload.output || []).forEach((entry) => {
    (entry.content || []).forEach((content) => {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.output_text === "string") chunks.push(content.output_text);
    });
  });
  return chunks.join("\n");
}

function normalizeItems(parsed, itemCount) {
  const rawItems = Array.isArray(parsed && parsed.items) ? parsed.items : [];
  const items = rawItems
    .map((item, index) => ({
      index: clampNumber(item.index || index + 1, 1, 40),
      title: cleanText(item.title || ""),
      confidence: clamp01(item.confidence),
      needsRescan: Boolean(item.needsRescan),
      notes: cleanText(item.notes || "")
    }))
    .filter((item) => item.title);
  if (!itemCount || items.length === itemCount) return items.slice(0, 40);
  const byIndex = new Map(items.map((item) => [item.index, item]));
  const normalized = [];
  for (let index = 1; index <= itemCount; index += 1) {
    normalized.push(byIndex.get(index) || {
      index,
      title: `Unclear spine ${index}`,
      confidence: 0.1,
      needsRescan: true,
      notes: "No readable title found for this row."
    });
  }
  return normalized;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

function cleanTitleForLookup(value) {
  return cleanText(value)
    .replace(/\b(vhs|dvd|blu[- ]?ray|disc|movie|video|home video|family feature)\b/gi, " ")
    .replace(/\b(hi[- ]?fi|stereo|closed captioned|rated|color|clamshell)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function isUsableTitle(title) {
  if (!title || /^unclear spine/i.test(title)) return false;
  const letters = (title.match(/[a-z]/gi) || []).length;
  const words = title.split(/\s+/).filter(Boolean);
  if (letters < 5 || !words.length) return false;
  const meaningful = words.filter((word) => /[a-z]{3,}/i.test(word) && /[aeiou]/i.test(word)).length;
  return meaningful > 0;
}

function lookupHasData(lookup) {
  if (!lookup || lookup.error) return false;
  return Number(lookup.activeCount || 0) > 0
    || Number(lookup.soldCount || 0) > 0
    || (Array.isArray(lookup.activeSample) && lookup.activeSample.length > 0)
    || (Array.isArray(lookup.soldSample) && lookup.soldSample.length > 0);
}

function lookupConfidence(title, lookup) {
  if (!lookupHasData(lookup)) return 0;
  const samples = []
    .concat(Array.isArray(lookup.soldSample) ? lookup.soldSample : [])
    .concat(Array.isArray(lookup.activeSample) ? lookup.activeSample : []);
  let best = 0;
  samples.slice(0, 8).forEach((item) => {
    best = Math.max(best, titleOverlap(title, item.title || ""));
  });
  return best;
}

function titleOverlap(first, second) {
  const firstWords = titleTokens(first);
  const secondWords = titleTokens(second);
  if (!firstWords.length || !secondWords.length) return 0;
  const secondSet = new Set(secondWords);
  const shared = firstWords.filter((word) => secondSet.has(word)).length;
  return shared / Math.max(firstWords.length, secondWords.length);
}

function titleTokens(value) {
  return cleanText(value).toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length >= 4 && !["with", "from", "the", "and", "edition", "movie"].includes(word));
}

function cleanImagePayload(value) {
  return String(value || "")
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "")
    .replace(/\s+/g, "")
    .trim();
}

function cleanText(text) {
  return String(text || "")
    .replace(/\.(jpg|jpeg|png|heic)$/i, "")
    .replace(/[_|]+/g, " ")
    .replace(/[^\w\s:'",.&!?/()#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function clampNumber(value, min, max) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clamp01(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  if (number > 1 && number <= 100) return Math.max(0, Math.min(1, number / 100));
  return Math.max(0, Math.min(1, number));
}

function roundNumber(value, digits) {
  const factor = Math.pow(10, digits || 0);
  return Math.round(Number(value || 0) * factor) / factor;
}

function optionalRequire(name) {
  try {
    return require(name);
  } catch (error) {
    return null;
  }
}

module.exports = { scanStackWithOpenAI };
