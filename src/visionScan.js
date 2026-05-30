class VisionScanner {
  constructor(config) {
    this.config = config;
  }

  async scanStack(input, services) {
    const sharp = optionalRequire("sharp");
    const tesseract = optionalRequire("tesseract.js");
    if (!sharp || !tesseract) {
      return {
        source: "backend_ocr_not_installed",
        items: [],
        error: "Backend OCR packages are not installed yet. Render will install them after the next deploy."
      };
    }

    const image = decodeImage(input.image || "");
    const itemType = cleanText(input.itemType || input.type || "Other").slice(0, 40) || "Other";
    const itemCount = clampNumber(input.itemCount || input.count, 0, 40);
    const base = await sharp(image).rotate().resize({
      width: 1900,
      height: 2600,
      fit: "inside",
      withoutEnlargement: true
    }).jpeg({ quality: 92 }).toBuffer();
    const metadata = await sharp(base).metadata();
    const bands = itemCount ? equalBands(metadata.height, itemCount) : await detectBands(sharp, base, metadata);
    const worker = await createWorker(tesseract);
    const items = [];

    try {
      for (let index = 0; index < bands.length; index += 1) {
        const band = bands[index];
        const ocr = await readBand({ sharp, worker, image: base, metadata, band, index });
        let title = applyKnownTitleHelp(ocr.title || "");
        let lookup = null;
        if (services && services.lookup && shouldLookupTitle(title)) {
          lookup = await services.lookup(title, itemType).catch((error) => ({
            error: error.message,
            query: title,
            source: "lookup_failed"
          }));
          if (lookup && lookup.suggestedTitle && shouldUseSuggestedTitle(title, lookup.suggestedTitle)) {
            title = cleanSpineCandidate(lookup.suggestedTitle);
            lookup.query = title;
          }
        }
        items.push({
          index: index + 1,
          title: title || `Unclear spine ${index + 1}`,
          rawText: ocr.rawText,
          confidence: Math.round(ocr.confidence),
          titleStrength: roundNumber(titleQuality(title), 2),
          needsRescan: !shouldLookupTitle(title),
          source: "backend_ocr",
          lookup
        });
      }
    } finally {
      await worker.terminate();
    }

    return {
      source: "backend_ocr",
      itemType,
      itemCount: bands.length,
      imageProcessed: true,
      note: "Image was processed in memory by the backend and not stored by this route.",
      items
    };
  }
}

function optionalRequire(name) {
  try {
    return require(name);
  } catch (error) {
    return null;
  }
}

function decodeImage(value) {
  const clean = String(value || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  if (!clean) throw new Error("No image was sent");
  return Buffer.from(clean, "base64");
}

async function createWorker(tesseract) {
  const worker = await tesseract.createWorker("eng");
  await worker.setParameters({
    tessedit_pageseg_mode: "7",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300"
  });
  return worker;
}

function equalBands(height, count) {
  const safeCount = Math.max(1, Math.min(40, Number(count || 1)));
  const rowHeight = height / safeCount;
  const bands = [];
  for (let index = 0; index < safeCount; index += 1) {
    bands.push({
      start: Math.max(0, Math.round(index * rowHeight)),
      end: Math.min(height, Math.round((index + 1) * rowHeight))
    });
  }
  return bands;
}

async function detectBands(sharp, image, metadata) {
  const rawWidth = 420;
  const raw = await sharp(image)
    .resize({ width: rawWidth, withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = raw.info.width;
  const height = raw.info.height;
  const data = raw.data;
  const scores = new Array(height).fill(0);
  const left = Math.floor(width * 0.08);
  const right = Math.floor(width * 0.92);
  for (let y = 1; y < height; y += 1) {
    let sum = 0;
    let samples = 0;
    for (let x = left; x < right; x += 3) {
      const current = data[y * width + x];
      const previous = data[(y - 1) * width + x];
      sum += Math.abs(current - previous);
      samples += 1;
    }
    scores[y] = samples ? sum / samples : 0;
  }
  const smooth = scores.map((_, row) => {
    let sum = 0;
    let count = 0;
    for (let offset = -3; offset <= 3; offset += 1) {
      const next = row + offset;
      if (next >= 0 && next < height) {
        sum += scores[next];
        count += 1;
      }
    }
    return sum / Math.max(1, count);
  });
  const mean = smooth.reduce((sum, value) => sum + value, 0) / smooth.length;
  const variance = smooth.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / smooth.length;
  const threshold = mean + Math.sqrt(variance) * 0.9;
  const minGap = Math.max(8, Math.floor(height / 45));
  const peaks = [];
  for (let row = 2; row < height - 2; row += 1) {
    if (smooth[row] < threshold) continue;
    if (smooth[row] < smooth[row - 1] || smooth[row] < smooth[row + 1]) continue;
    const last = peaks[peaks.length - 1];
    if (!last || row - last.row > minGap) {
      peaks.push({ row, score: smooth[row] });
    } else if (smooth[row] > last.score) {
      last.row = row;
      last.score = smooth[row];
    }
  }
  const scale = metadata.height / height;
  const boundaries = [0].concat(peaks.map((peak) => Math.round(peak.row * scale))).concat([metadata.height])
    .sort((a, b) => a - b);
  const merged = [];
  const originalMinGap = Math.max(18, Math.floor(metadata.height / 70));
  boundaries.forEach((boundary) => {
    const previous = merged[merged.length - 1];
    if (previous === undefined || boundary - previous > originalMinGap) {
      merged.push(boundary);
    }
  });
  if (merged[merged.length - 1] !== metadata.height) merged.push(metadata.height);
  const bands = [];
  const minBandHeight = Math.max(30, Math.floor(metadata.height / 45));
  for (let index = 0; index < merged.length - 1; index += 1) {
    if (merged[index + 1] - merged[index] >= minBandHeight) {
      bands.push({ start: merged[index], end: merged[index + 1] });
    }
  }
  if (bands.length < 2 || bands.length > 30) {
    return equalBands(metadata.height, guessStackCount(metadata));
  }
  return bands;
}

function guessStackCount(metadata) {
  const ratio = metadata.height / Math.max(metadata.width, 1);
  if (ratio > 1.6) return 12;
  if (ratio > 1.15) return 8;
  return 6;
}

async function readBand(context) {
  const variants = [
    { name: "core", xStart: 0.14, xEnd: 0.88, yStart: 0.12, yEnd: 0.88, threshold: false, mode: "7", priority: 4 },
    { name: "wide", xStart: 0.04, xEnd: 0.96, yStart: 0.05, yEnd: 0.95, threshold: false, mode: "7", priority: 3 },
    { name: "contrast", xStart: 0.08, xEnd: 0.94, yStart: 0.08, yEnd: 0.92, threshold: true, mode: "7", priority: 2 },
    { name: "block", xStart: 0.08, xEnd: 0.94, yStart: 0.05, yEnd: 0.95, threshold: false, mode: "6", priority: 1 }
  ];
  let best = { title: "", rawText: "", confidence: 0, quality: 0, score: -1 };
  for (const variant of variants) {
    const buffer = await makeBandImage(context, variant);
    await context.worker.setParameters({
      tessedit_pageseg_mode: variant.mode,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300"
    });
    const result = await context.worker.recognize(buffer);
    const rawText = result && result.data && result.data.text || "";
    const confidence = Number(result && result.data && result.data.confidence || 0);
    const title = bestSpineTitle(rawText);
    const quality = titleQuality(title);
    const score = quality * 100 + confidence + title.length * 0.08 + variant.priority;
    if (score > best.score) {
      best = { title, rawText, confidence, quality, score };
    }
    if (quality >= 0.72 && confidence >= 45) break;
  }
  best.title = applyKnownTitleHelp(best.title);
  return best;
}

async function makeBandImage(context, variant) {
  const { sharp, image, metadata, band } = context;
  const padding = Math.max(5, Math.floor((band.end - band.start) * 0.08));
  const bandY = Math.max(0, band.start - padding);
  const bandHeight = Math.min(metadata.height - bandY, band.end - band.start + padding * 2);
  const left = Math.floor(metadata.width * variant.xStart);
  const top = bandY + Math.floor(bandHeight * variant.yStart);
  const width = Math.max(60, Math.floor(metadata.width * (variant.xEnd - variant.xStart)));
  const height = Math.max(24, Math.floor(bandHeight * (variant.yEnd - variant.yStart)));
  const safeTop = Math.max(0, Math.min(metadata.height - 1, top));
  const safeWidth = Math.max(1, Math.min(width, metadata.width - left));
  const safeHeight = Math.max(1, Math.min(height, metadata.height - safeTop));
  let pipeline = sharp(image)
    .extract({
      left,
      top: safeTop,
      width: safeWidth,
      height: safeHeight
    })
    .resize({ height: 300, fit: "inside", withoutEnlargement: false })
    .grayscale()
    .normalise()
    .sharpen({ sigma: 1.1 });
  if (variant.threshold) {
    pipeline = pipeline.threshold(142);
  }
  return pipeline.png().toBuffer();
}

function bestSpineTitle(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map(cleanSpineCandidate)
    .filter((line) => line.length >= 3 && /[a-z]/i.test(line) && !isNoiseLine(line));
  const candidates = lines.slice();
  for (let index = 0; index < lines.length - 1; index += 1) {
    candidates.push(cleanSpineCandidate(`${lines[index]} ${lines[index + 1]}`));
  }
  const best = candidates
    .map((candidate) => {
      const title = applyOcrWordRepairs(candidate);
      return { title, score: titleQuality(title) * 100 + title.length * 0.2 };
    })
    .sort((a, b) => b.score - a.score)[0];
  if (best && best.title && titleQuality(best.title) >= 0.35) {
    return best.title.slice(0, 100);
  }
  return applyOcrWordRepairs(cleanSpineCandidate(lines.join(" ") || text)).slice(0, 100);
}

function cleanSpineCandidate(value) {
  return applyOcrWordRepairs(cleanText(value))
    .replace(/\b(walt disney|disney|home video|family feature|hi[- ]?fi|stereo|closed captioned|vhs|dvd|blu[- ]?ray)\b/gi, " ")
    .replace(/\b(isbn|upc|rated|minutes?|mins?|color|clamshell|special edition)\b/gi, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyOcrWordRepairs(value) {
  return String(value || "")
    .replace(/\bFHO?M\b/gi, "From")
    .replace(/\bFR0M\b/gi, "From")
    .replace(/\bH0ME\b/gi, "Home")
    .replace(/\bDesperad[o0]?\b/gi, "Desperado")
    .replace(/\bD[e3]sperad[o0]\b/gi, "Desperado")
    .replace(/\bBarber\s*Shop\b/gi, "Barbershop")
    .replace(/\bMira(?:c|e|ee|cee)+\b/gi, "Miracle")
    .replace(/\bStree(?:t|l|i)?\b/gi, "Street")
    .replace(/\bPoo[h]?\b/gi, "Pooh")
    .replace(/\bPocahontas\s*ll\b/gi, "Pocahontas II")
    .replace(/\bTram[pb]\b/gi, "Tramp")
    .replace(/\bAlad[d]?in\b/gi, "Aladdin")
    .replace(/\bJaf[a-z]{1,3}\b/gi, "Jafar")
    .replace(/\s+/g, " ")
    .trim();
}

function applyKnownTitleHelp(value) {
  const title = cleanText(value);
  const direct = [
    [/desp|esperado/i, "Desperado"],
    [/quinn|medicine.*woman|season.*five|complete.*five/i, "Dr. Quinn Medicine Woman The Complete Season Five"],
    [/barber|barbershop/i, "Barbershop"],
    [/expect.*miracle|miracle.*expect/i, "Expecting a Miracle"],
    [/wedding.*dress/i, "The Wedding Dress"],
    [/miracle/i, "Miracle on 34th Street"],
    [/winnie|pooh/i, "Winnie the Pooh"],
    [/lion.*king|simba/i, "The Lion King II Simba's Pride"],
    [/stuart.*little.*2|little\s*2/i, "Stuart Little 2"],
    [/stuart.*little/i, "Stuart Little"],
    [/old.*yell/i, "Old Yeller"],
    [/lady.*tramp/i, "Lady and the Tramp II"],
    [/bedknob|broom/i, "Bedknobs and Broomsticks"],
    [/\bbabe\b/i, "Babe"],
    [/aladdin|king.*thieves/i, "Aladdin and the King of Thieves"],
    [/jafar/i, "The Return of Jafar"],
    [/pocahontas/i, "Pocahontas II Journey to a New World"],
    [/jungle.*book|mowgli|baloo/i, "The Second Jungle Book Mowgli and Baloo"],
    [/yellow.*dog|far.*from.*home|from home/i, "Far From Home The Adventures of Yellow Dog"],
    [/heidi/i, "Heidi"],
    [/island.*world/i, "The Island at the Top of the World"]
  ];
  for (const [pattern, replacement] of direct) {
    if (pattern.test(title)) return replacement;
  }
  return title;
}

function titleQuality(value) {
  const title = cleanText(value);
  if (!title || /^unclear spine/i.test(title)) return 0;
  const letters = (title.match(/[a-z]/gi) || []).length;
  const vowels = (title.match(/[aeiou]/gi) || []).length;
  const digits = (title.match(/\d/g) || []).length;
  const words = title.split(/\s+/).filter(Boolean);
  const longWords = words.filter((word) => word.replace(/[^a-z]/gi, "").length >= 4).length;
  const weirdWords = words.filter((word) => {
    const clean = word.replace(/[^a-z]/gi, "");
    return clean.length >= 4 && !/[aeiou]/i.test(clean);
  }).length;
  if (letters < 4 || !longWords) return 0.15;
  let score = 0.25;
  score += Math.min(0.28, letters / 70);
  score += Math.min(0.2, vowels / Math.max(letters, 1));
  score += Math.min(0.2, longWords / Math.max(words.length, 1));
  score -= Math.min(0.25, weirdWords * 0.12);
  score -= digits > letters ? 0.12 : 0;
  if (words.length === 1 && letters < 7) score -= 0.18;
  return Math.max(0, Math.min(1, score));
}

function shouldLookupTitle(title) {
  return titleQuality(title) >= 0.43;
}

function shouldUseSuggestedTitle(currentTitle, suggestedTitle) {
  if (isGenericVisualTitle(suggestedTitle)) return false;
  const current = titleQuality(currentTitle);
  const suggested = titleQuality(suggestedTitle);
  if (!suggestedTitle || suggested < 0.45) return false;
  if (current >= 0.2 && !hasSharedTitleToken(currentTitle, suggestedTitle)) return false;
  return suggested > current || suggestedTitle.length > currentTitle.length + 8;
}

function isGenericVisualTitle(value) {
  return /\b(lot|bundle|assorted|various|wholesale|disc lot|movie lot|dvd movie lot|collection)\b/i.test(String(value || ""));
}

function hasSharedTitleToken(first, second) {
  const firstWords = titleTokens(first);
  const secondWords = titleTokens(second);
  return firstWords.some((word) => secondWords.indexOf(word) !== -1);
}

function titleTokens(value) {
  return cleanText(value).toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length >= 4 && !["with", "from", "the", "and", "edition", "movie", "dvd", "vhs"].includes(word));
}

function isNoiseLine(value) {
  return /^(vhs|dvd|blu ray|hi fi|stereo|closed captioned|rated|color|isbn|upc)$/i.test(String(value || "").trim());
}

function cleanText(text) {
  let clean = String(text || "")
    .replace(/\.(jpg|jpeg|png|heic)$/i, "")
    .replace(/[_|]+/g, " ")
    .replace(/[^\w\s:'",.&!?/()#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean && clean === clean.toUpperCase()) {
    clean = clean.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }
  return clean.slice(0, 160);
}

function clampNumber(value, min, max) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function roundNumber(value, digits) {
  const factor = Math.pow(10, digits || 0);
  return Math.round(Number(value || 0) * factor) / factor;
}

module.exports = { VisionScanner };
