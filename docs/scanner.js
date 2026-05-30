(function () {
  "use strict";

  var STORAGE_KEY = "universal-spine-scans-v1";
  var API_BASE_KEY = "universal-spine-api-base-url-v1";
  var DEFAULT_API_BASE = "https://universal-spine-scanner.onrender.com";
  var STATIC_PAGES_MODE = window.location.hostname.endsWith("github.io") || window.location.protocol === "file:";
  var state = {
    itemType: "VHS",
    queue: [],
    currentIndex: -1,
    currentImage: null,
    currentFileName: "",
    rotation: 0,
    cropMode: "full",
    scanBox: null,
    scanBoxDrag: null,
    contrast: false,
    ocrRaw: "",
    currentLookup: null,
    apiBaseUrl: "",
    scans: []
  };

  var els = {
    typeButtons: document.getElementById("itemTypeButtons"),
    cameraInput: document.getElementById("cameraInput"),
    batchInput: document.getElementById("batchInput"),
    clearQueue: document.getElementById("clearQueue"),
    queueText: document.getElementById("queueText"),
    currentImageTitle: document.getElementById("currentImageTitle"),
    retakeButton: document.getElementById("retakeButton"),
    canvas: document.getElementById("scanCanvas"),
    scanBoxOverlay: document.getElementById("scanBoxOverlay"),
    fitStackBox: document.getElementById("fitStackBox"),
    resetStackBox: document.getElementById("resetStackBox"),
    emptyCanvas: document.getElementById("emptyCanvas"),
    rotateLeft: document.getElementById("rotateLeft"),
    rotateRight: document.getElementById("rotateRight"),
    contrastButton: document.getElementById("contrastButton"),
    fullCrop: document.getElementById("fullCrop"),
    cropLeft: document.getElementById("cropLeft"),
    cropCenter: document.getElementById("cropCenter"),
    cropRight: document.getElementById("cropRight"),
    scanHorizontal: document.getElementById("scanHorizontal"),
    scanVertical: document.getElementById("scanVertical"),
    scanStack: document.getElementById("scanStack"),
    stackCount: document.getElementById("stackCount"),
    backendStatus: document.getElementById("backendStatus"),
    backendPanel: document.getElementById("backendPanel"),
    apiBaseUrl: document.getElementById("apiBaseUrl"),
    saveApiBase: document.getElementById("saveApiBase"),
    liveLookupStatus: document.getElementById("liveLookupStatus"),
    liveResults: document.getElementById("liveResults"),
    ocrProgress: document.getElementById("ocrProgress"),
    ocrStatus: document.getElementById("ocrStatus"),
    cleanTitle: document.getElementById("cleanTitle"),
    subtitle: document.getElementById("subtitle"),
    barcode: document.getElementById("barcode"),
    condition: document.getElementById("condition"),
    sealed: document.getElementById("sealed"),
    decision: document.getElementById("decision"),
    notes: document.getElementById("notes"),
    paidPrice: document.getElementById("paidPrice"),
    soldPrice: document.getElementById("soldPrice"),
    saveScan: document.getElementById("saveScan"),
    nextPhoto: document.getElementById("nextPhoto"),
    valueLookup: document.getElementById("valueLookup"),
    valueResult: document.getElementById("valueResult"),
    exportCsv: document.getElementById("exportCsv"),
    scanList: document.getElementById("scanList"),
    savedCount: document.getElementById("savedCount"),
    bucketBoard: document.getElementById("bucketBoard")
  };

  function init() {
    state.apiBaseUrl = loadApiBaseUrl();
    if (els.apiBaseUrl) els.apiBaseUrl.value = state.apiBaseUrl;
    state.scans = loadLocalScans();
    bindEvents();
    renderList();
    checkBackendStatus();
    refreshBackendScans();
    registerServiceWorker();
    renderQueue();
    renderCanvas();
  }

  function bindEvents() {
    els.typeButtons.addEventListener("click", function (event) {
      var button = event.target.closest("[data-type]");
      if (!button) return;
      state.itemType = button.getAttribute("data-type");
      Array.from(els.typeButtons.querySelectorAll("[data-type]")).forEach(function (item) {
        item.classList.toggle("active", item === button);
      });
    });

    els.cameraInput.addEventListener("change", function () {
      addFiles(els.cameraInput.files, { replace: true });
      els.cameraInput.value = "";
    });

    els.batchInput.addEventListener("change", function () {
      addFiles(els.batchInput.files, { replace: false });
      els.batchInput.value = "";
    });

    els.clearQueue.addEventListener("click", function () {
      state.queue = [];
      state.currentIndex = -1;
      state.currentImage = null;
      state.currentFileName = "";
      resetImageTools();
      renderQueue();
      renderCanvas();
    });

    els.retakeButton.addEventListener("click", function () {
      els.cameraInput.click();
    });

    els.fitStackBox.addEventListener("click", function () {
      fitScanBoxToStack();
    });

    els.resetStackBox.addEventListener("click", function () {
      if (!state.currentImage) return;
      state.scanBox = { x: 0, y: 0, width: 1, height: 1 };
      updateScanBoxOverlay();
      setStatus("Full photo selected.");
    });

    els.scanBoxOverlay.addEventListener("pointerdown", startScanBoxDrag);
    document.addEventListener("pointermove", moveScanBoxDrag);
    document.addEventListener("pointerup", endScanBoxDrag);
    window.addEventListener("resize", updateScanBoxOverlay);

    els.rotateLeft.addEventListener("click", function () {
      state.rotation = (state.rotation + 270) % 360;
      state.scanBox = null;
      renderCanvas();
    });

    els.rotateRight.addEventListener("click", function () {
      state.rotation = (state.rotation + 90) % 360;
      state.scanBox = null;
      renderCanvas();
    });

    els.contrastButton.addEventListener("click", function () {
      state.contrast = !state.contrast;
      els.contrastButton.classList.toggle("active", state.contrast);
      renderCanvas();
    });

    [
      [els.fullCrop, "full"],
      [els.cropLeft, "left"],
      [els.cropCenter, "center"],
      [els.cropRight, "right"]
    ].forEach(function (pair) {
      pair[0].addEventListener("click", function () {
        state.cropMode = pair[1];
        state.scanBox = null;
        updateCropButtons();
        renderCanvas();
      });
    });

    els.scanHorizontal.addEventListener("click", function () {
      runOcr("horizontal");
    });

    els.scanVertical.addEventListener("click", function () {
      runOcr("vertical");
    });
    els.scanStack.addEventListener("click", runStackScan);
    els.liveResults.addEventListener("click", handleLiveResultClick);
    els.liveResults.addEventListener("change", handleLiveResultEdit);
    els.saveApiBase.addEventListener("click", saveApiBaseUrl);

    els.saveScan.addEventListener("click", saveCurrentScan);
    els.nextPhoto.addEventListener("click", moveNext);
    els.valueLookup.addEventListener("click", runValueLookup);
    els.exportCsv.addEventListener("click", exportCsv);

    document.querySelectorAll("[data-lookup]").forEach(function (button) {
      button.addEventListener("click", function () {
        openLookup(button.getAttribute("data-lookup"));
      });
    });
  }

  function addFiles(fileList, options) {
    var files = Array.from(fileList || []).filter(function (file) {
      return file.type && file.type.indexOf("image/") === 0;
    });
    if (!files.length) {
      setStatus("No image files found.");
      return;
    }
    Promise.all(files.map(readImageFile)).then(function (items) {
      if (options && options.replace) {
        state.queue = items;
        state.currentIndex = -1;
      } else {
        state.queue = state.queue.concat(items);
      }
      if (state.currentIndex === -1) {
        loadQueueItem(0);
      } else {
        renderQueue();
      }
    }).catch(function () {
      setStatus("Could not read one of those photos.");
    });
  }

  function readImageFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve({ name: file.name, dataUrl: reader.result });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadQueueItem(index) {
    if (index < 0 || index >= state.queue.length) {
      state.currentIndex = -1;
      state.currentImage = null;
      state.currentFileName = "";
      renderQueue();
      renderCanvas();
      return;
    }
    var item = state.queue[index];
    var image = new Image();
    image.onload = function () {
      state.currentIndex = index;
      state.currentImage = image;
      state.currentFileName = item.name;
      resetImageTools();
      clearFormForNext();
      renderQueue();
      renderCanvas();
    };
    image.src = item.dataUrl;
  }

  function moveNext() {
    if (state.currentIndex + 1 < state.queue.length) {
      loadQueueItem(state.currentIndex + 1);
    } else {
      setStatus("End of batch. Add more photos when ready.");
    }
  }

  function resetImageTools() {
    state.rotation = 0;
    state.cropMode = "full";
    state.scanBox = null;
    state.scanBoxDrag = null;
    state.contrast = false;
    state.ocrRaw = "";
    state.currentLookup = null;
    els.contrastButton.classList.remove("active");
    updateCropButtons();
    setProgress(0);
    renderValueResult(null);
  }

  function clearFormForNext() {
    els.cleanTitle.value = "";
    els.subtitle.value = "";
    els.barcode.value = "";
    els.notes.value = "";
    els.paidPrice.value = "";
    els.soldPrice.value = "";
    els.decision.value = "scanned";
    setStatus("Ready to scan OCR.");
  }

  function renderQueue() {
    if (!state.queue.length) {
      els.queueText.textContent = "No photos queued";
      els.currentImageTitle.textContent = "No image selected";
      return;
    }
    els.queueText.textContent = "Photo " + (state.currentIndex + 1) + " of " + state.queue.length;
    els.currentImageTitle.textContent = state.currentFileName || "Photo queued";
  }

  function renderCanvas() {
    if (!state.currentImage) {
      els.canvas.style.display = "none";
      els.scanBoxOverlay.hidden = true;
      els.emptyCanvas.style.display = "block";
      return;
    }
    var processed = makeProcessedCanvas();
    els.canvas.width = processed.width;
    els.canvas.height = processed.height;
    els.canvas.getContext("2d").drawImage(processed, 0, 0);
    els.canvas.style.display = "block";
    els.emptyCanvas.style.display = "none";
    if (!state.scanBox) {
      state.scanBox = defaultScanBoxFor(processed);
    }
    requestAnimationFrame(updateScanBoxOverlay);
  }

  function makeProcessedCanvas() {
    var rotated = rotateImageToCanvas(state.currentImage, state.rotation);
    var cropped = cropCanvas(rotated, state.cropMode);
    if (state.contrast) {
      boostContrast(cropped);
    }
    return cropped;
  }

  function rotateImageToCanvas(image, rotation) {
    var turn = ((rotation % 360) + 360) % 360;
    var sideways = turn === 90 || turn === 270;
    var canvas = document.createElement("canvas");
    canvas.width = sideways ? image.height : image.width;
    canvas.height = sideways ? image.width : image.height;
    var ctx = canvas.getContext("2d");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(turn * Math.PI / 180);
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    return canvas;
  }

  function cropCanvas(source, mode) {
    if (mode === "full") {
      return cloneCanvas(source);
    }
    var width = source.width;
    var height = source.height;
    var cropWidth = Math.max(80, Math.floor(width * 0.46));
    var x = 0;
    if (mode === "center") x = Math.floor((width - cropWidth) / 2);
    if (mode === "right") x = width - cropWidth;
    var canvas = document.createElement("canvas");
    canvas.width = cropWidth;
    canvas.height = height;
    canvas.getContext("2d").drawImage(source, x, 0, cropWidth, height, 0, 0, cropWidth, height);
    return canvas;
  }

  function cloneCanvas(source) {
    var canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d").drawImage(source, 0, 0);
    return canvas;
  }

  function rotateCanvas(source, degrees) {
    var imageLike = new Image();
    imageLike.src = source.toDataURL("image/jpeg", 0.92);
    return new Promise(function (resolve) {
      imageLike.onload = function () {
        resolve(rotateImageToCanvas(imageLike, degrees));
      };
    });
  }

  function boostContrast(canvas) {
    var ctx = canvas.getContext("2d");
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var data = imageData.data;
    var factor = 1.45;
    for (var index = 0; index < data.length; index += 4) {
      data[index] = clamp((data[index] - 128) * factor + 128);
      data[index + 1] = clamp((data[index + 1] - 128) * factor + 128);
      data[index + 2] = clamp((data[index + 2] - 128) * factor + 128);
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function clamp(value) {
    return Math.max(0, Math.min(255, value));
  }

  function updateCropButtons() {
    [
      [els.fullCrop, "full"],
      [els.cropLeft, "left"],
      [els.cropCenter, "center"],
      [els.cropRight, "right"]
    ].forEach(function (pair) {
      pair[0].classList.toggle("active", state.cropMode === pair[1]);
    });
  }

  async function runOcr(mode) {
    if (!state.currentImage) {
      setStatus("Take or choose a photo first.");
      return;
    }
    if (!hasLiveBackend() && !window.Tesseract) {
      setStatus("OCR library did not load. Check your internet connection once, then try again.");
      return;
    }
    setProgress(0.03);
    setStatus(mode === "vertical" ? "Scanning vertical spine text..." : "Scanning horizontal text...");
    disableOcr(true);
    try {
      var base = makeProcessedCanvas();
      var candidates = mode === "vertical"
        ? [await rotateCanvas(base, 90), await rotateCanvas(base, 270)]
        : [base];
      var best = { text: "", confidence: 0 };
      for (var index = 0; index < candidates.length; index += 1) {
        var result = await window.Tesseract.recognize(candidates[index], "eng", {
          logger: function (message) {
            if (message.status === "recognizing text") {
              setProgress(Math.max(0.05, message.progress || 0));
            }
          }
        });
        var data = result && result.data || {};
        var text = data.text || "";
        var score = Number(data.confidence || 0) + cleanTitle(text).length * 0.2;
        if (score > best.confidence) {
          best = { text: text, confidence: score };
        }
      }
      state.ocrRaw = best.text;
      els.cleanTitle.value = cleanTitle(best.text);
      setProgress(1);
      setStatus(els.cleanTitle.value ? "OCR done. Edit the title if needed." : "OCR found little text. Try crop, rotate, or manual typing.");
    } catch (error) {
      setStatus("OCR failed: " + error.message);
    } finally {
      disableOcr(false);
    }
  }

  function disableOcr(disabled) {
    els.scanHorizontal.disabled = disabled;
    els.scanVertical.disabled = disabled;
    els.scanStack.disabled = disabled;
  }

  async function readSpineBand(band, bandIndex, bandCount) {
    var variants = makeSpineOcrVariants(band);
    var best = { title: "", rawText: "", confidence: 0, quality: 0, score: -1 };
    for (var variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      var variant = variants[variantIndex];
      var result = await window.Tesseract.recognize(variant.canvas, "eng", {
        tessedit_pageseg_mode: variant.mode || "7",
        preserve_interword_spaces: "1",
        logger: function (message) {
          if (message.status === "recognizing text") {
            var variantShare = 1 / Math.max(1, variants.length);
            var progress = (bandIndex + (variantIndex * variantShare) + (Math.max(0.02, message.progress || 0) * variantShare)) / bandCount;
            setProgress(progress);
          }
        }
      });
      var rawText = result && result.data && result.data.text || "";
      var confidence = Number(result && result.data && result.data.confidence || 0);
      var title = bestSpineTitle(rawText);
      var quality = titleQuality(title);
      var score = quality * 100 + confidence + title.length * 0.08 + (variant.priority || 0);
      if (score > best.score) {
        best = { title: title, rawText: rawText, confidence: confidence, quality: quality, score: score };
      }
      if (quality >= 0.72 && confidence >= 45) break;
    }
    best.title = applyKnownTitleHelp(best.title);
    best.quality = titleQuality(best.title);
    if (!shouldLookupTitle(best.title)) {
      best.title = best.title || "";
    }
    return best;
  }

  async function lookupBandImage(band) {
    if (!hasLiveBackend()) return null;
    if (isMediaSpineType(state.itemType)) return null;
    var image = imagePayloadForLookup(band);
    if (!image) return null;
    return api("/api/lookup-ebay-image", {
      method: "POST",
      body: JSON.stringify({
        image: image,
        itemType: state.itemType
      })
    });
  }

  function isMediaSpineType(itemType) {
    return /^(vhs|dvd|blu-ray|book|game|cd)$/i.test(String(itemType || ""));
  }

  function imagePayloadForLookup(source) {
    var maxWidth = 900;
    var scale = Math.min(1, maxWidth / Math.max(source.width, 1));
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.76).replace(/^data:image\/jpeg;base64,/, "");
  }

  function imagePayloadForBackend(source) {
    var maxSide = 1800;
    var scale = Math.min(1, maxSide / Math.max(source.width, source.height, 1));
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.84).replace(/^data:image\/jpeg;base64,/, "");
  }

  function makeSpineOcrVariants(source) {
    var variants = [
      { name: "center-strip", xStart: 0.12, xEnd: 0.9, yStart: 0.12, yEnd: 0.88, threshold: false, priority: 4, mode: "7" },
      { name: "title-core", xStart: 0.2, xEnd: 0.84, yStart: 0.16, yEnd: 0.84, threshold: false, priority: 5, mode: "7" },
      { name: "wide", xStart: 0.04, xEnd: 0.96, yStart: 0.06, yEnd: 0.94, threshold: false, priority: 2, mode: "7" },
      { name: "middle", xStart: 0.12, xEnd: 0.9, yStart: 0.05, yEnd: 0.95, threshold: false, priority: 1, mode: "6" },
      { name: "high-contrast", xStart: 0.12, xEnd: 0.9, yStart: 0.12, yEnd: 0.88, threshold: true, priority: 0, mode: "7" }
    ];
    return variants.map(function (variant) {
      return {
        name: variant.name,
        priority: variant.priority,
        mode: variant.mode,
        canvas: prepareSpineOcrCanvas(source, variant)
      };
    });
  }

  function prepareSpineOcrCanvas(source, options) {
    var x = Math.floor(source.width * options.xStart);
    var width = Math.max(40, Math.floor(source.width * (options.xEnd - options.xStart)));
    var y = Math.floor(source.height * (options.yStart || 0));
    var height = Math.max(18, Math.floor(source.height * ((options.yEnd || 1) - (options.yStart || 0))));
    var targetHeight = Math.max(210, Math.min(340, height * 4));
    var scale = targetHeight / Math.max(1, height);
    var targetWidth = Math.max(520, Math.min(2200, Math.round(width * scale)));
    var canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
    normalizeOcrPixels(canvas, Boolean(options.threshold));
    return canvas;
  }

  function normalizeOcrPixels(canvas, threshold) {
    var ctx = canvas.getContext("2d");
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var data = imageData.data;
    var total = 0;
    for (var index = 0; index < data.length; index += 4) {
      total += (data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114);
    }
    var mean = total / Math.max(1, data.length / 4);
    var factor = threshold ? 1.95 : 1.55;
    for (var pixel = 0; pixel < data.length; pixel += 4) {
      var lum = (data[pixel] * 0.299) + (data[pixel + 1] * 0.587) + (data[pixel + 2] * 0.114);
      lum = clamp((lum - mean) * factor + 148);
      if (threshold) {
        lum = lum > 142 ? 255 : 0;
      }
      data[pixel] = lum;
      data[pixel + 1] = lum;
      data[pixel + 2] = lum;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  async function runStackScan() {
    if (!state.currentImage) {
      setStatus("Take or choose a stack photo first.");
      return;
    }
    if (!hasLiveBackend() && !window.Tesseract) {
      setStatus("OCR library did not load. Check your internet connection once, then try again.");
      return;
    }
    var base = makeProcessedCanvas();
    base = cropByScanBox(base);
    var typedCount = Number(els.stackCount.value || 0);
    var stackSource = state.scanBox && isFullScanBox(state.scanBox) ? cropLikelyStackArea(base) : base;
    var bands = splitStackBands(stackSource, typedCount);
    els.liveResults.innerHTML = "";
    setLiveStatus("Found " + bands.length + " possible spine rows. Scanning now...");
    setStatus(hasLiveBackend() ? "Backend scan running. This can take longer, but should read better." : "Live stack scan running. This can take a minute.");
    setProgress(0.02);
    disableOcr(true);
    try {
      if (hasLiveBackend()) {
        await runBackendStackScan(stackSource, typedCount || bands.length);
        return;
      }
      var results = [];
      setLiveStatus("Reading the whole stack first...");
      var stackHints = await readStackTextHints(stackSource, bands.length).catch(function () {
        return [];
      });
      for (var index = 0; index < bands.length; index += 1) {
        var band = cropBandCanvas(stackSource, bands[index]);
        setLiveStatus("Scanning spine " + (index + 1) + " of " + bands.length + "...");
        var ocr = await readSpineBand(band, index, bands.length);
        var hintedTitle = stackHints[index] || "";
        if (hintedTitle && (ocr.quality < 0.58 || titleQuality(hintedTitle) > ocr.quality + 0.08)) {
          ocr.title = hintedTitle;
          ocr.quality = titleQuality(hintedTitle);
          ocr.rawText = [ocr.rawText, "Stack hint: " + hintedTitle].filter(Boolean).join("\n");
        }
        var title = ocr.title || "Unclear spine " + (index + 1);
        var imageLookup = await lookupBandImage(band).catch(function () {
          return null;
        });
        if (imageLookup && imageLookup.suggestedTitle && shouldUseSuggestedTitle(title, imageLookup.suggestedTitle)) {
          title = cleanSpineCandidate(imageLookup.suggestedTitle);
          ocr.quality = Math.max(ocr.quality, titleQuality(title));
        }
        var acceptedImageTitle = Boolean(imageLookup && imageLookup.suggestedTitle && title === cleanSpineCandidate(imageLookup.suggestedTitle));
        var lookup = shouldLookupTitle(title)
          ? await api("/api/lookup-ebay?title=" + encodeURIComponent(title) + "&itemType=" + encodeURIComponent(state.itemType))
            .catch(function () {
              return imageLookup || buildStaticEbayLookup(title);
            })
          : (imageLookup && imageLookup.suggestedTitle ? imageLookup : buildNoLookup(title, "OCR and visual match were not clear enough yet."));
        lookup = enrichLookup(lookup);
        if (lookup.suggestedTitle && shouldUseSuggestedTitle(title, lookup.suggestedTitle)) {
          title = cleanSpineCandidate(lookup.suggestedTitle);
          lookup.query = title;
        }
        results.push({
          id: cryptoId(),
          title: title,
          rawText: ocr.rawText,
          imageMatched: acceptedImageTitle,
          quality: ocr.quality,
          confidence: ocr.confidence,
          needsRescan: !shouldLookupTitle(title),
          lookup: lookup,
          memory: findMemoryMatch(title),
          thumb: band.toDataURL("image/jpeg", 0.72)
        });
        renderLiveResults(results);
      }
      setProgress(1);
      setLiveStatus(hasLiveBackend() ? "Done. Check the weak titles, then rescan tighter if needed." : "Open the Render app to use live eBay data.");
      setStatus("Live lookup list is ready.");
    } catch (error) {
      setLiveStatus("Stack scan stopped: " + error.message);
      setStatus("Try typing the item count, cropping tighter, or rotating the image.");
    } finally {
      disableOcr(false);
    }
  }

  async function runBackendStackScan(stackSource, itemCount) {
    setLiveStatus("Sending cropped photo to backend OCR...");
    setProgress(0.08);
    var payload = await api("/api/scan-stack", {
      method: "POST",
      body: JSON.stringify({
        image: imagePayloadForBackend(stackSource),
        itemType: state.itemType,
        itemCount: itemCount
      })
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    var results = (payload.items || []).map(function (item) {
      var title = cleanTitle(item.title || "");
      return {
        id: cryptoId(),
        title: title || "Unclear spine " + item.index,
        rawText: item.rawText || "",
        imageMatched: false,
        quality: Number(item.titleStrength || 0),
        confidence: Number(item.confidence || 0),
        needsRescan: Boolean(item.needsRescan),
        lookup: enrichLookup(item.lookup || buildNoLookup(title, "Backend OCR found a title but eBay lookup did not return data.")),
        memory: findMemoryMatch(title),
        thumb: ""
      };
    });
    renderLiveResults(results);
    setProgress(1);
    setLiveStatus("Done. Backend OCR checked the photo and loaded the result cards.");
    setStatus("Backend scan complete.");
  }

  function equalBands(source, count) {
    var safeCount = Math.max(1, Math.min(40, Number(count || 1)));
    var height = source.height;
    var rowHeight = height / safeCount;
    var bands = [];
    for (var index = 0; index < safeCount; index += 1) {
      bands.push({
        start: Math.max(0, Math.round(index * rowHeight)),
        end: Math.min(height, Math.round((index + 1) * rowHeight))
      });
    }
    return bands;
  }

  async function readStackTextHints(source, bandCount) {
    if (!isMediaSpineType(state.itemType)) return [];
    var variants = makeStackOcrVariants(source);
    var best = [];
    for (var index = 0; index < variants.length; index += 1) {
      var variant = variants[index];
      var result = await window.Tesseract.recognize(variant.canvas, "eng", {
        tessedit_pageseg_mode: variant.mode || "6",
        preserve_interword_spaces: "1",
        logger: function (message) {
          if (message.status === "recognizing text") {
            setProgress(Math.max(0.02, Math.min(0.22, (index + (message.progress || 0)) / variants.length * 0.22)));
          }
        }
      });
      var rawText = result && result.data && result.data.text || "";
      var hints = parseStackTitleHints(rawText, bandCount);
      if (hints.length > best.length) {
        best = hints;
      }
      if (hints.length >= Math.min(bandCount, 4)) {
        break;
      }
    }
    return best.slice(0, bandCount);
  }

  function makeStackOcrVariants(source) {
    var variants = [
      { name: "stack-center", xStart: 0.08, xEnd: 0.92, yStart: 0.02, yEnd: 0.98, threshold: false, priority: 3, mode: "6" },
      { name: "stack-title-core", xStart: 0.16, xEnd: 0.86, yStart: 0.02, yEnd: 0.98, threshold: false, priority: 4, mode: "6" },
      { name: "stack-wide-contrast", xStart: 0.04, xEnd: 0.96, yStart: 0.02, yEnd: 0.98, threshold: true, priority: 1, mode: "6" }
    ];
    return variants.map(function (variant) {
      return {
        name: variant.name,
        priority: variant.priority,
        mode: variant.mode,
        canvas: prepareStackOcrCanvas(source, variant)
      };
    });
  }

  function prepareStackOcrCanvas(source, options) {
    var x = Math.floor(source.width * options.xStart);
    var width = Math.max(80, Math.floor(source.width * (options.xEnd - options.xStart)));
    var y = Math.floor(source.height * (options.yStart || 0));
    var height = Math.max(60, Math.floor(source.height * ((options.yEnd || 1) - (options.yStart || 0))));
    var targetWidth = 1600;
    var scale = targetWidth / Math.max(1, width);
    var targetHeight = Math.max(420, Math.min(2600, Math.round(height * scale)));
    var canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
    normalizeOcrPixels(canvas, Boolean(options.threshold));
    return canvas;
  }

  function parseStackTitleHints(text, bandCount) {
    var rows = String(text || "")
      .split(/\n+/)
      .map(cleanSpineCandidate)
      .filter(function (line) {
        return line.length >= 3 && /[a-z]/i.test(line) && !isNoiseLine(line);
      });
    var candidates = [];
    rows.forEach(function (line) {
      candidates.push(line);
    });
    for (var index = 0; index < rows.length - 1; index += 1) {
      var combined = cleanSpineCandidate(rows[index] + " " + rows[index + 1]);
      if (titleQuality(combined) >= 0.5) {
        candidates.push(combined);
      }
    }
    var hints = [];
    candidates.forEach(function (candidate) {
      var title = applyKnownTitleHelp(candidate);
      if (!title || titleQuality(title) < 0.43) return;
      if (hints.some(function (existing) { return similarTitle(existing, title); })) return;
      hints.push(title.slice(0, 100));
    });
    return hints.slice(0, Math.max(1, bandCount || hints.length));
  }

  function similarTitle(first, second) {
    var firstTokens = titleTokens(first);
    var secondTokens = titleTokens(second);
    if (!firstTokens.length || !secondTokens.length) return false;
    var shared = firstTokens.filter(function (word) { return secondTokens.indexOf(word) !== -1; }).length;
    return shared / Math.min(firstTokens.length, secondTokens.length) >= 0.65;
  }

  function defaultScanBoxFor(source) {
    var bounds = detectStackBounds(source);
    if (bounds) {
      return clampScanBox({
        x: bounds.left / source.width,
        y: bounds.top / source.height,
        width: (bounds.right - bounds.left) / source.width,
        height: (bounds.bottom - bounds.top) / source.height
      });
    }
    return { x: 0.05, y: 0.28, width: 0.9, height: 0.62 };
  }

  function fitScanBoxToStack() {
    if (!state.currentImage) {
      setStatus("Take or choose a photo first.");
      return;
    }
    var processed = makeProcessedCanvas();
    state.scanBox = defaultScanBoxFor(processed);
    updateScanBoxOverlay();
    setStatus("Scan box fitted to the visible stack.");
  }

  function cropByScanBox(source) {
    var box = clampScanBox(state.scanBox || { x: 0, y: 0, width: 1, height: 1 });
    var x = Math.max(0, Math.round(box.x * source.width));
    var y = Math.max(0, Math.round(box.y * source.height));
    var width = Math.max(1, Math.min(source.width - x, Math.round(box.width * source.width)));
    var height = Math.max(1, Math.min(source.height - y, Math.round(box.height * source.height)));
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(source, x, y, width, height, 0, 0, width, height);
    return canvas;
  }

  function updateScanBoxOverlay() {
    if (!state.currentImage || els.canvas.style.display === "none") {
      els.scanBoxOverlay.hidden = true;
      return;
    }
    if (!state.scanBox) {
      state.scanBox = { x: 0, y: 0, width: 1, height: 1 };
    }
    var box = clampScanBox(state.scanBox);
    state.scanBox = box;
    var canvasRect = els.canvas.getBoundingClientRect();
    var wrapRect = els.canvas.parentElement.getBoundingClientRect();
    if (!canvasRect.width || !canvasRect.height) {
      els.scanBoxOverlay.hidden = true;
      return;
    }
    els.scanBoxOverlay.hidden = false;
    els.scanBoxOverlay.style.left = (canvasRect.left - wrapRect.left + box.x * canvasRect.width) + "px";
    els.scanBoxOverlay.style.top = (canvasRect.top - wrapRect.top + box.y * canvasRect.height) + "px";
    els.scanBoxOverlay.style.width = (box.width * canvasRect.width) + "px";
    els.scanBoxOverlay.style.height = (box.height * canvasRect.height) + "px";
  }

  function startScanBoxDrag(event) {
    if (!state.currentImage || !state.scanBox) return;
    event.preventDefault();
    var handle = event.target.closest("[data-handle]");
    state.scanBoxDrag = {
      mode: handle ? handle.getAttribute("data-handle") : "move",
      startX: event.clientX,
      startY: event.clientY,
      startBox: Object.assign({}, state.scanBox),
      canvasRect: els.canvas.getBoundingClientRect()
    };
    if (els.scanBoxOverlay.setPointerCapture) {
      els.scanBoxOverlay.setPointerCapture(event.pointerId);
    }
  }

  function moveScanBoxDrag(event) {
    if (!state.scanBoxDrag) return;
    event.preventDefault();
    var drag = state.scanBoxDrag;
    var dx = (event.clientX - drag.startX) / Math.max(1, drag.canvasRect.width);
    var dy = (event.clientY - drag.startY) / Math.max(1, drag.canvasRect.height);
    var box = Object.assign({}, drag.startBox);
    if (drag.mode === "move") {
      box.x += dx;
      box.y += dy;
    } else {
      if (drag.mode.indexOf("w") !== -1) {
        box.x += dx;
        box.width -= dx;
      }
      if (drag.mode.indexOf("e") !== -1) {
        box.width += dx;
      }
      if (drag.mode.indexOf("n") !== -1) {
        box.y += dy;
        box.height -= dy;
      }
      if (drag.mode.indexOf("s") !== -1) {
        box.height += dy;
      }
    }
    state.scanBox = clampScanBox(box);
    updateScanBoxOverlay();
  }

  function endScanBoxDrag() {
    if (!state.scanBoxDrag) return;
    state.scanBoxDrag = null;
    setStatus("Scan box ready.");
  }

  function clampScanBox(box) {
    var minWidth = 0.16;
    var minHeight = 0.08;
    var width = Math.max(minWidth, Math.min(1, Number(box.width || minWidth)));
    var height = Math.max(minHeight, Math.min(1, Number(box.height || minHeight)));
    var x = Math.max(0, Math.min(1 - width, Number(box.x || 0)));
    var y = Math.max(0, Math.min(1 - height, Number(box.y || 0)));
    return { x: x, y: y, width: width, height: height };
  }

  function isFullScanBox(box) {
    return !box || (box.x <= 0.005 && box.y <= 0.005 && box.width >= 0.99 && box.height >= 0.99);
  }

  function cropLikelyStackArea(source) {
    var bounds = detectStackBounds(source);
    if (!bounds) return source;
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, bounds.right - bounds.left);
    canvas.height = Math.max(1, bounds.bottom - bounds.top);
    canvas.getContext("2d").drawImage(
      source,
      bounds.left,
      bounds.top,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return canvas;
  }

  function detectStackBounds(source) {
    var maxWidth = 420;
    var scale = Math.min(1, maxWidth / Math.max(source.width, 1));
    var width = Math.max(80, Math.round(source.width * scale));
    var height = Math.max(80, Math.round(source.height * scale));
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, width, height);
    var data = ctx.getImageData(0, 0, width, height).data;
    var rowScores = new Array(height).fill(0);
    var colScores = new Array(width).fill(0);
    for (var y = 1; y < height - 1; y += 1) {
      for (var x = 1; x < width - 1; x += 1) {
        var offset = (y * width + x) * 4;
        var previous = ((y - 1) * width + x) * 4;
        var r = data[offset];
        var g = data[offset + 1];
        var b = data[offset + 2];
        var max = Math.max(r, g, b);
        var min = Math.min(r, g, b);
        var sat = max - min;
        var lum = (r * 0.299) + (g * 0.587) + (b * 0.114);
        var prevLum = (data[previous] * 0.299) + (data[previous + 1] * 0.587) + (data[previous + 2] * 0.114);
        var edge = Math.abs(lum - prevLum);
        var content = sat * 0.9 + edge * 1.4 + Math.max(0, 210 - lum) * 0.18;
        rowScores[y] += content;
        colScores[x] += content;
      }
    }
    rowScores = rowScores.map(function (score) { return score / Math.max(1, width); });
    colScores = colScores.map(function (score) { return score / Math.max(1, height); });
    var topBottom = strongestContentRange(rowScores, Math.max(20, Math.floor(height * 0.08)), 0.58);
    var leftRight = strongestContentRange(colScores, Math.max(20, Math.floor(width * 0.16)), 0.5);
    if (!topBottom || !leftRight) return null;
    var top = Math.max(0, Math.round(topBottom.start / scale) - Math.round(source.height * 0.015));
    var bottom = Math.min(source.height, Math.round(topBottom.end / scale) + Math.round(source.height * 0.02));
    var left = Math.max(0, Math.round(leftRight.start / scale) - Math.round(source.width * 0.035));
    var right = Math.min(source.width, Math.round(leftRight.end / scale) + Math.round(source.width * 0.035));
    if (bottom - top < source.height * 0.12 || right - left < source.width * 0.35) return null;
    if (bottom - top > source.height * 0.92 && right - left > source.width * 0.92) return null;
    return { top: top, bottom: bottom, left: left, right: right };
  }

  function strongestContentRange(scores, minSize, thresholdWeight) {
    if (!scores.length) return null;
    var smooth = scores.map(function (_, index) {
      var sum = 0;
      var count = 0;
      for (var offset = -4; offset <= 4; offset += 1) {
        var current = index + offset;
        if (current >= 0 && current < scores.length) {
          sum += scores[current];
          count += 1;
        }
      }
      return sum / Math.max(1, count);
    });
    var max = Math.max.apply(null, smooth);
    var mean = smooth.reduce(function (sum, value) { return sum + value; }, 0) / smooth.length;
    var threshold = mean + (max - mean) * thresholdWeight;
    var ranges = [];
    var start = -1;
    for (var index = 0; index < smooth.length; index += 1) {
      if (smooth[index] >= threshold && start === -1) start = index;
      if ((smooth[index] < threshold || index === smooth.length - 1) && start !== -1) {
        var end = smooth[index] < threshold ? index : index + 1;
        if (end - start >= minSize) {
          ranges.push({ start: start, end: end, score: rangeScore(smooth, start, end) });
        }
        start = -1;
      }
    }
    if (!ranges.length) return null;
    ranges.sort(function (a, b) {
      return (b.score * Math.sqrt(b.end - b.start)) - (a.score * Math.sqrt(a.end - a.start));
    });
    return ranges[0];
  }

  function rangeScore(values, start, end) {
    var sum = 0;
    for (var index = start; index < end; index += 1) {
      sum += values[index] || 0;
    }
    return sum / Math.max(1, end - start);
  }

  function splitStackBands(source, typedCount) {
    if (typedCount > 0) {
      return equalBands(source, typedCount);
    }
    var detected = detectHorizontalBands(source);
    if (detected.length >= 2) {
      return detected;
    }
    return equalBands(source, guessStackCount(source));
  }

  function guessStackCount(source) {
    var ratio = source.height / Math.max(source.width, 1);
    if (ratio > 1.6) return 12;
    if (ratio > 1.15) return 8;
    return 6;
  }

  function detectHorizontalBands(source) {
    var scale = Math.min(1, 420 / source.width);
    var width = Math.max(80, Math.round(source.width * scale));
    var height = Math.max(80, Math.round(source.height * scale));
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, width, height);
    var data = ctx.getImageData(0, 0, width, height).data;
    var scores = new Array(height).fill(0);
    var left = Math.floor(width * 0.08);
    var right = Math.floor(width * 0.92);
    for (var y = 1; y < height; y += 1) {
      var sum = 0;
      var samples = 0;
      for (var x = left; x < right; x += 3) {
        var current = (y * width + x) * 4;
        var previous = ((y - 1) * width + x) * 4;
        var lumCurrent = (data[current] + data[current + 1] + data[current + 2]) / 3;
        var lumPrevious = (data[previous] + data[previous + 1] + data[previous + 2]) / 3;
        sum += Math.abs(lumCurrent - lumPrevious);
        samples += 1;
      }
      scores[y] = samples ? sum / samples : 0;
    }
    var smooth = scores.map(function (_, y) {
      var sum = 0;
      var count = 0;
      for (var offset = -3; offset <= 3; offset += 1) {
        var row = y + offset;
        if (row >= 0 && row < height) {
          sum += scores[row];
          count += 1;
        }
      }
      return sum / Math.max(1, count);
    });
    var mean = smooth.reduce(function (sum, value) { return sum + value; }, 0) / smooth.length;
    var variance = smooth.reduce(function (sum, value) { return sum + Math.pow(value - mean, 2); }, 0) / smooth.length;
    var threshold = mean + Math.sqrt(variance) * 0.85;
    var minGap = Math.max(8, Math.floor(height / 45));
    var peaks = [];
    for (var rowIndex = 2; rowIndex < height - 2; rowIndex += 1) {
      if (smooth[rowIndex] < threshold) continue;
      if (smooth[rowIndex] < smooth[rowIndex - 1] || smooth[rowIndex] < smooth[rowIndex + 1]) continue;
      var last = peaks[peaks.length - 1];
      if (!last || rowIndex - last.row > minGap) {
        peaks.push({ row: rowIndex, score: smooth[rowIndex] });
      } else if (smooth[rowIndex] > last.score) {
        last.row = rowIndex;
        last.score = smooth[rowIndex];
      }
    }
    var boundaries = [0].concat(peaks.map(function (peak) {
      return Math.round(peak.row / scale);
    })).concat([source.height]).sort(function (a, b) { return a - b; });
    var merged = [];
    var originalMinGap = Math.max(18, Math.floor(source.height / 70));
    boundaries.forEach(function (boundary) {
      var previous = merged[merged.length - 1];
      if (previous === undefined || boundary - previous > originalMinGap) {
        merged.push(boundary);
      }
    });
    if (merged[merged.length - 1] !== source.height) {
      merged.push(source.height);
    }
    var bands = [];
    var minBandHeight = Math.max(30, Math.floor(source.height / 45));
    for (var index = 0; index < merged.length - 1; index += 1) {
      if (merged[index + 1] - merged[index] >= minBandHeight) {
        bands.push({ start: merged[index], end: merged[index + 1] });
      }
    }
    if (bands.length > 30 || bands.length < 3) {
      return [];
    }
    return bands;
  }

  function cropBandCanvas(source, band) {
    var padding = Math.max(4, Math.floor((band.end - band.start) * 0.08));
    var y = Math.max(0, band.start - padding);
    var height = Math.min(source.height - y, band.end - band.start + padding * 2);
    var canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = Math.max(1, height);
    canvas.getContext("2d").drawImage(source, 0, y, source.width, height, 0, 0, source.width, height);
    return canvas;
  }

  function bestSpineTitle(text) {
    var lines = String(text || "")
      .split(/\n+/)
      .map(cleanSpineCandidate)
      .filter(function (line) {
        return line.length >= 3 && /[a-z]/i.test(line) && !isNoiseLine(line);
      });
    var candidates = lines.slice();
    for (var index = 0; index < lines.length - 1; index += 1) {
      candidates.push(cleanSpineCandidate(lines[index] + " " + lines[index + 1]));
    }
    var best = candidates
      .map(function (candidate) {
        candidate = applyOcrWordRepairs(candidate);
        return { title: candidate, score: titleQuality(candidate) * 100 + candidate.length * 0.2 };
      })
      .sort(function (a, b) { return b.score - a.score; })[0];
    if (best && best.title && titleQuality(best.title) >= 0.35) {
      return best.title.slice(0, 100);
    }
    var combined = cleanSpineCandidate(lines.join(" "));
    if (combined.length >= 4) {
      return applyOcrWordRepairs(combined).slice(0, 100);
    }
    return applyOcrWordRepairs(cleanSpineCandidate(text)).slice(0, 100);
  }

  function cleanSpineCandidate(value) {
    return applyOcrWordRepairs(cleanTitle(value))
      .replace(/\b(walt disney|disney|home video|family feature|hi[- ]?fi|stereo|closed captioned|vhs|dvd|blu[- ]?ray)\b/gi, " ")
      .replace(/\b(isbn|upc|rated|minutes?|mins?|color|clamshell)\b/gi, " ")
      .replace(/\b\d{4,}\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isNoiseLine(value) {
    return /^(vhs|dvd|blu ray|hi fi|stereo|closed captioned|rated|color|isbn|upc)$/i.test(value.trim());
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
    var title = cleanTitle(value);
    var direct = [
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
    for (var index = 0; index < direct.length; index += 1) {
      if (direct[index][0].test(title)) return direct[index][1];
    }
    return title;
  }

  function titleQuality(value) {
    var title = cleanTitle(value);
    if (!title || /^unclear spine/i.test(title)) return 0;
    var letters = (title.match(/[a-z]/gi) || []).length;
    var vowels = (title.match(/[aeiou]/gi) || []).length;
    var digits = (title.match(/\d/g) || []).length;
    var words = title.split(/\s+/).filter(Boolean);
    var longWords = words.filter(function (word) { return word.replace(/[^a-z]/gi, "").length >= 4; }).length;
    var weirdWords = words.filter(function (word) {
      var clean = word.replace(/[^a-z]/gi, "");
      return clean.length >= 4 && !/[aeiou]/i.test(clean);
    }).length;
    if (letters < 4 || !longWords) return 0.15;
    var score = 0.25;
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
    var current = titleQuality(currentTitle);
    var suggested = titleQuality(suggestedTitle);
    if (!suggestedTitle || suggested < 0.45) return false;
    if (current >= 0.2 && !hasSharedTitleToken(currentTitle, suggestedTitle)) return false;
    return suggested > current || suggestedTitle.length > currentTitle.length + 8;
  }

  function isGenericVisualTitle(value) {
    return /\b(lot|bundle|assorted|various|wholesale|disc lot|movie lot|dvd movie lot|collection)\b/i.test(String(value || ""));
  }

  function hasSharedTitleToken(first, second) {
    var firstWords = titleTokens(first);
    var secondWords = titleTokens(second);
    return firstWords.some(function (word) {
      return secondWords.indexOf(word) !== -1;
    });
  }

  function titleTokens(value) {
    return cleanTitle(value).toLowerCase()
      .split(/\s+/)
      .map(function (word) { return word.replace(/[^a-z0-9]/g, ""); })
      .filter(function (word) {
        return word.length >= 4 && ["with", "from", "the", "and", "edition", "movie", "dvd", "vhs"].indexOf(word) === -1;
      });
  }

  function renderLiveResults(results) {
    if (!results.length) {
      els.liveResults.innerHTML = "";
      return;
    }
    els.liveResults.innerHTML = results.map(function (result, index) {
      var lookup = enrichLookup(result.lookup || buildStaticEbayLookup(result.title));
      var score = result.needsRescan ? { color: "unknown", label: "Rescan", reason: "OCR title is too weak.", decision: "review" } : scoreFor(lookup);
      if (result.needsRescan && !hasLookupSamples(lookup)) {
        return renderRescanResult(result, index, score);
      }
      var price = lookup.estimatedPrice ? money(lookup.estimatedPrice) : "No price";
      var activeCount = Number(lookup.activeCount || 0);
      var soldCount = Number(lookup.soldCount || 0);
      var totalCount = activeCount + soldCount;
      var quality = Math.round(Number(result.quality || 0) * 100);
      var note = result.needsRescan
        ? "Needs a clearer title. Crop tighter or retake closer."
        : (result.imageMatched ? "Matched with image + OCR." : "Read by OCR.");
      return (
        '<article class="live-result-row score-' + escapeAttr(score.color) + '">' +
          '<div class="result-mainline">' +
            '<span class="live-number">' + (index + 1) + '</span>' +
            '<input class="live-title-input" data-live-title="' + index + '" value="' + escapeAttr(result.title) + '">' +
            '<span class="score-pill">' + escapeHtml(score.label) + '</span>' +
          '</div>' +
          '<div class="metric-row">' +
            '<span><strong>' + escapeHtml(price) + '</strong><small>price</small></span>' +
            '<span><strong>' + escapeHtml(formatRate(lookup.sellThroughRate)) + '</strong><small>STR</small></span>' +
            '<span><strong>' + escapeHtml(String(totalCount || activeCount || "-")) + '</strong><small>' + escapeHtml(soldCount ? "sold+active" : "active") + '</small></span>' +
          '</div>' +
          '<p class="result-note">' + escapeHtml(note + " " + quality + "% title strength. " + score.reason) + '</p>' +
          renderMarketSamples(lookup, result) +
        '</article>'
      );
    }).join("");
  }

  function renderRescanResult(result, index, score) {
    return (
      '<article class="live-result-row rescan-result score-' + escapeAttr(score.color) + '">' +
        '<div class="result-mainline">' +
          '<span class="live-number">' + (index + 1) + '</span>' +
          '<input class="live-title-input" data-live-title="' + index + '" value="" placeholder="Retake closer or type title">' +
          '<span class="score-pill">' + escapeHtml(score.label) + '</span>' +
        '</div>' +
        '<p class="result-note">Could not read this spine clearly. Crop tighter around the stack or retake closer.</p>' +
        (result.title && !/^unclear spine/i.test(result.title) ? '<p class="ocr-clue">OCR clue: ' + escapeHtml(result.title) + '</p>' : '') +
      '</article>'
    );
  }

  function hasLookupSamples(lookup) {
    return Number(lookup.activeCount || 0) > 0
      || Number(lookup.soldCount || 0) > 0
      || (Array.isArray(lookup.activeSample) && lookup.activeSample.length > 0)
      || (Array.isArray(lookup.soldSample) && lookup.soldSample.length > 0);
  }

  function handleLiveResultClick(event) {
    var button = event.target.closest("[data-live-action]");
    if (!button) return;
    var index = button.getAttribute("data-index");
    var input = els.liveResults.querySelector('[data-live-title="' + index + '"]');
    var title = cleanTitle(input && input.value || "");
    if (!title) return;
    window.open(urlForLookup(button.getAttribute("data-live-action"), title), "_blank", "noopener");
  }

  function handleLiveResultEdit(event) {
    var input = event.target.closest("[data-live-sold], [data-live-active], [data-live-price], [data-live-title]");
    if (!input) return;
    if (input.hasAttribute("data-live-title")) return;
    var row = input.closest(".live-result-row");
    if (!row) return;
    var sold = moneyNumber((row.querySelector("[data-live-sold]") || {}).value);
    var active = moneyNumber((row.querySelector("[data-live-active]") || {}).value);
    var price = moneyNumber((row.querySelector("[data-live-price]") || {}).value);
    var rate = calculateStr({ soldCount: sold, activeCount: active });
    var score = scoreFor({ estimatedPrice: price, sellThroughRate: rate });
    row.classList.remove("score-red", "score-yellow", "score-green", "score-gold", "score-unknown");
    row.classList.add("score-" + score.color);
    var pill = row.querySelector(".score-pill");
    var bucket = row.querySelector(".live-bucket");
    if (pill) pill.textContent = score.label;
    if (bucket) {
      bucket.textContent = bucketForPrice(price) + " - " + money(price) + " - STR " + formatRate(rate) + " - " + score.reason;
    }
  }

  function setLiveStatus(message) {
    els.liveLookupStatus.textContent = message;
  }

  function cleanTitle(text) {
    var clean = String(text || "")
      .replace(/\.(jpg|jpeg|png|heic)$/i, "")
      .replace(/[_|]+/g, " ")
      .replace(/[^\w\s:'",.&!?/()#-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (clean && clean === clean.toUpperCase()) {
      clean = clean.toLowerCase().replace(/\b[a-z]/g, function (letter) {
        return letter.toUpperCase();
      });
    }
    return clean.slice(0, 160);
  }

  function saveCurrentScan() {
    var title = cleanTitle(els.cleanTitle.value);
    if (!title) {
      setStatus("Add the title first.");
      els.cleanTitle.focus();
      return;
    }
    var scan = {
      id: cryptoId(),
      title: title,
      itemType: state.itemType,
      subtitle: els.subtitle.value.trim(),
      barcode: els.barcode.value.trim(),
      condition: els.condition.value,
      sealed: els.sealed.value,
      notes: els.notes.value.trim(),
      paidPrice: moneyNumber(els.paidPrice.value),
      soldPrice: moneyNumber(els.soldPrice.value),
      imageName: state.currentFileName,
      lookupStatus: state.currentLookup ? state.currentLookup.valueBucket + " / " + state.currentLookup.source : "not looked up",
      decision: state.currentLookup && state.currentLookup.resaleDecision || els.decision.value,
      estimatedPrice: state.currentLookup && state.currentLookup.estimatedPrice || 0,
      sellThroughRate: state.currentLookup && state.currentLookup.sellThroughRate,
      activeCount: state.currentLookup && state.currentLookup.activeCount || 0,
      soldCount: state.currentLookup && state.currentLookup.soldCount || 0,
      valueBucket: state.currentLookup && state.currentLookup.valueBucket || bucketForPrice(0),
      score: state.currentLookup && state.currentLookup.score || scoreFor({ estimatedPrice: 0, sellThroughRate: null }),
      ocrRaw: state.ocrRaw,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.scans.unshift(scan);
    persistLocalScans();
    renderList();
    api("/api/save-scan", { method: "POST", body: JSON.stringify(scan) }).catch(function () {
      return null;
    });
    setStatus("Saved. Ready for the next item.");
    moveNext();
  }

  function runValueLookup() {
    var query = cleanTitle(els.cleanTitle.value);
    if (!query) {
      setStatus("Add the title before checking value.");
      els.cleanTitle.focus();
      return;
    }
    els.valueLookup.disabled = true;
    renderValueResult({ loading: true, query: query });
    api("/api/lookup-ebay?title=" + encodeURIComponent(query) + "&itemType=" + encodeURIComponent(state.itemType))
      .then(function (lookup) {
        state.currentLookup = enrichLookup(lookup);
        if (lookup.resaleDecision) {
          els.decision.value = lookup.resaleDecision;
        }
        renderValueResult(state.currentLookup);
        setStatus("Value checked. Review the bucket and save when ready.");
      })
      .catch(function (error) {
        var fallback = enrichLookup(buildStaticEbayLookup(query));
        renderValueResult(Object.assign(fallback, { warning: error.message }));
        setStatus("Practice mode opened search links. Full value math needs the backend later.");
      })
      .finally(function () {
        els.valueLookup.disabled = false;
      });
  }

  function renderValueResult(lookup) {
    if (!lookup) {
      els.valueResult.className = "value-result";
      els.valueResult.innerHTML = "<strong>No value check yet</strong><span>Scan or type a title, then check eBay value.</span>";
      return;
    }
    if (lookup.loading) {
      els.valueResult.className = "value-result";
      els.valueResult.innerHTML = "<strong>Checking eBay...</strong><span>" + escapeHtml(lookup.query || "") + "</span>";
      return;
    }
    if (lookup.error) {
      els.valueResult.className = "value-result skip";
      els.valueResult.innerHTML = "<strong>Value check failed</strong><span>" + escapeHtml(lookup.error) + "</span>";
      return;
    }
    lookup = enrichLookup(lookup);
    var price = money(lookup.estimatedPrice || 0);
    var rate = formatRate(lookup.sellThroughRate);
    var score = scoreFor(lookup);
    els.valueResult.className = "value-result score-" + score.color;
    els.valueResult.innerHTML =
      "<strong>" + escapeHtml(score.label) + " - " + escapeHtml(lookup.valueBucket || bucketForPrice(lookup.estimatedPrice)) + " - " + price + "</strong>" +
      "<span>STR " + escapeHtml(rate) + " | active " + Number(lookup.activeCount || 0) + " | sold " + Number(lookup.soldCount || 0) + " | " + escapeHtml(score.reason) + "</span>" +
      "<span>Decision: " + escapeHtml(lookup.resaleDecision || score.decision || "review") + "</span>" +
      renderMarketSamples(lookup) +
      (lookup.warnings && lookup.warnings.length ? "<span>Note: sold API may need approval. Use the eBay sold button too.</span>" : "");
  }

  function openLookup(type) {
    var query = cleanTitle(els.cleanTitle.value) || selectedListTitle();
    var barcode = els.barcode.value.trim();
    if (!query && !barcode) {
      setStatus("Add or select a title first.");
      return;
    }
    if (type === "ebay-active" || type === "ebay-sold") {
      api("/api/lookup-ebay?title=" + encodeURIComponent(query) + "&itemType=" + encodeURIComponent(state.itemType))
        .then(function (lookup) {
          window.open(type === "ebay-active" ? lookup.activeUrl : lookup.soldUrl, "_blank", "noopener");
        })
        .catch(function () {
          var fallback = buildStaticEbayLookup(query);
          window.open(type === "ebay-active" ? fallback.activeUrl : fallback.soldUrl, "_blank", "noopener");
        });
      return;
    }
    if (type === "book") {
      api("/api/lookup-books?title=" + encodeURIComponent(query) + "&barcode=" + encodeURIComponent(barcode))
        .then(function (lookup) {
          if (lookup.title && !els.cleanTitle.value.trim()) {
            els.cleanTitle.value = cleanTitle(lookup.title + " " + (lookup.subtitle || ""));
          }
          window.open(lookup.openLibraryUrl || lookup.googleBooksUrl, "_blank", "noopener");
        })
        .catch(function () {
          var isbn = barcode.replace(/[^0-9X]/gi, "");
          var url = isbn ? "https://openlibrary.org/isbn/" + encodeURIComponent(isbn) : "https://openlibrary.org/search?q=" + encodeURIComponent(query);
          window.open(url, "_blank", "noopener");
        });
      return;
    }
    var urls = {
      google: urlForLookup("google", query + " resale value"),
      amazon: "https://www.amazon.com/s?k=" + encodeURIComponent(barcode || query),
      manual: urlForLookup("google", query)
    };
    window.open(urls[type], "_blank", "noopener");
  }

  function urlForLookup(type, title) {
    var clean = cleanTitle(title);
    if (type === "active") {
      return "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(clean);
    }
    if (type === "sold") {
      return "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(clean) + "&LH_Sold=1&LH_Complete=1";
    }
    return "https://www.google.com/search?q=" + encodeURIComponent(clean);
  }

  function selectedListTitle() {
    return state.scans[0] && state.scans[0].title || "";
  }

  function renderList() {
    els.savedCount.textContent = state.scans.length + " item" + (state.scans.length === 1 ? "" : "s");
    renderBuckets();
    if (!state.scans.length) {
      els.scanList.innerHTML = '<div class="empty-list">Nothing scanned yet</div>';
      return;
    }
    els.scanList.innerHTML = state.scans.slice(0, 60).map(function (scan) {
      var score = scan.score || scoreFor(scan);
      return (
        '<article class="scan-row score-' + escapeAttr(score.color) + '">' +
          '<strong>' + escapeHtml(scan.title) + '</strong>' +
          '<div class="scan-meta">' + escapeHtml(scan.itemType) + " - " + escapeHtml(scan.condition || "used") + " - " + escapeHtml(scan.sealed || "open") + '</div>' +
          '<div class="decision-row">' +
            '<span class="decision-chip">' + escapeHtml(score.label) + '</span>' +
            '<span class="decision-chip">' + escapeHtml(scan.decision || "scanned") + '</span>' +
            '<span class="decision-chip">' + escapeHtml(scan.valueBucket || bucketForPrice(scan.estimatedPrice)) + '</span>' +
            (scan.estimatedPrice ? '<span class="decision-chip">' + escapeHtml(money(scan.estimatedPrice)) + '</span>' : '') +
            (scan.sellThroughRate !== null && scan.sellThroughRate !== undefined ? '<span class="decision-chip">STR ' + escapeHtml(formatRate(scan.sellThroughRate)) + '</span>' : '') +
            (scan.paidPrice ? '<span class="decision-chip">Paid ' + escapeHtml(money(scan.paidPrice)) + '</span>' : '') +
            (scan.soldPrice ? '<span class="decision-chip">Sold ' + escapeHtml(money(scan.soldPrice)) + '</span>' : '') +
            (scan.barcode ? '<span class="decision-chip">Code ' + escapeHtml(scan.barcode) + '</span>' : '') +
            (scan.subtitle ? '<span class="decision-chip">' + escapeHtml(scan.subtitle) + '</span>' : '') +
          '</div>' +
        '</article>'
      );
    }).join("");
  }

  function renderBuckets() {
    var buckets = ["under $10", "over $10", "over $20", "over $50"];
    var counts = buckets.reduce(function (map, bucket) {
      map[bucket] = 0;
      return map;
    }, {});
    state.scans.forEach(function (scan) {
      var bucket = scan.valueBucket || bucketForPrice(scan.estimatedPrice);
      counts[bucket] = (counts[bucket] || 0) + 1;
    });
    els.bucketBoard.innerHTML = buckets.map(function (bucket) {
      return '<div class="bucket-card"><strong>' + counts[bucket] + '</strong><span>' + escapeHtml(bucket) + '</span></div>';
    }).join("");
  }

  function exportCsv() {
    var rows = [[
      "title",
      "item type",
      "subtitle/edition",
      "barcode/isbn",
      "condition",
      "sealed/open",
      "notes",
      "lookup status",
      "decision",
      "estimated price",
      "sell through rate",
      "value bucket",
      "score color",
      "what I paid",
      "sold for",
      "created at"
    ]].concat(state.scans.map(function (scan) {
      return [
        scan.title,
        scan.itemType,
        scan.subtitle,
        scan.barcode,
        scan.condition,
        scan.sealed,
        scan.notes,
        scan.lookupStatus,
        scan.decision,
        scan.estimatedPrice || "",
        scan.sellThroughRate === null || scan.sellThroughRate === undefined ? "" : scan.sellThroughRate,
        scan.valueBucket || "",
        (scan.score && scan.score.color) || scoreFor(scan).color,
        scan.paidPrice || "",
        scan.soldPrice || "",
        scan.createdAt
      ];
    }));
    var csv = rows.map(function (row) {
      return row.map(csvCell).join(",");
    }).join("\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "spine-scans.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    return '"' + String(value || "").replace(/"/g, '""') + '"';
  }

  function refreshBackendScans() {
    api("/api/get-scans")
      .then(function (body) {
        if (body.scans && body.scans.length > state.scans.length) {
          state.scans = body.scans;
          persistLocalScans();
          renderList();
        }
      })
      .catch(function () {
        return null;
      });
  }

  function api(path, options) {
    var apiUrl = apiUrlFor(path);
    if (!apiUrl) {
      return Promise.reject(new Error("Backend is not connected in GitHub Pages practice mode."));
    }
    return fetch(apiUrl, Object.assign({
      headers: { "Content-Type": "application/json" }
    }, options || {})).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) {
          throw new Error(body.error || "Request failed");
        }
        return body;
      });
    });
  }

  function apiUrlFor(path) {
    if (!STATIC_PAGES_MODE) return path;
    if (!state.apiBaseUrl) return "";
    return state.apiBaseUrl.replace(/\/+$/, "") + "/" + String(path || "").replace(/^\/+/, "");
  }

  function renderMarketSamples(lookup) {
    var sold = Array.isArray(lookup.soldSample) ? lookup.soldSample : [];
    var active = Array.isArray(lookup.activeSample) ? lookup.activeSample : [];
    if (!sold.length && !active.length) {
      return '<div class="market-samples empty">' + escapeHtml(lookup.noLookupReason || "No confident eBay match yet. Crop tighter or retake closer.") + '</div>';
    }
    return (
      '<div class="market-samples">' +
        (sold.length ? renderSampleColumn("Sold sample", sold) : "") +
        (active.length ? renderSampleColumn("Active sample", active) : "") +
      '</div>'
    );
  }

  function sellerMemoryFor(result) {
    var lookup = result && result.lookup || {};
    var seller = lookup.sellerMemory || lookup.myHistory || null;
    if (seller && seller.found) {
      var pieces = ["My eBay memory: sold/listed before"];
      if (seller.soldDate) pieces.push(shortDate(seller.soldDate));
      if (seller.soldPrice) pieces.push("sold " + money(seller.soldPrice));
      if (seller.listedPrice) pieces.push("listed " + money(seller.listedPrice));
      return pieces.join(" - ");
    }
    if (!hasLiveBackend()) return "My eBay memory: connect backend + seller OAuth";
    return "My eBay memory: seller history not connected yet";
  }

  function renderSampleColumn(label, items) {
    if (!items.length) {
      return '<div class="sample-column"><strong>' + escapeHtml(label) + '</strong><span>No sample yet</span></div>';
    }
    return (
      '<div class="sample-column"><strong>' + escapeHtml(label) + '</strong>' +
        items.slice(0, 3).map(function (item) {
          return (
            '<a href="' + escapeAttr(item.url || "#") + '" target="_blank" rel="noopener">' +
              '<span>' + escapeHtml(money(item.price || 0)) + '</span>' +
              '<small>' + escapeHtml(item.title || "eBay item") + '</small>' +
            '</a>'
          );
        }).join("") +
      '</div>'
    );
  }

  function hasLiveBackend() {
    return !STATIC_PAGES_MODE || Boolean(state.apiBaseUrl);
  }

  function loadApiBaseUrl() {
    var fromUrl = new URLSearchParams(window.location.search).get("api");
    if (fromUrl) {
      localStorage.setItem(API_BASE_KEY, fromUrl.trim());
      return fromUrl.trim();
    }
    return localStorage.getItem(API_BASE_KEY) || (STATIC_PAGES_MODE ? DEFAULT_API_BASE : "");
  }

  function saveApiBaseUrl() {
    if (!els.apiBaseUrl) return;
    state.apiBaseUrl = els.apiBaseUrl.value.trim().replace(/\/+$/, "");
    if (state.apiBaseUrl) {
      localStorage.setItem(API_BASE_KEY, state.apiBaseUrl);
    } else {
      localStorage.removeItem(API_BASE_KEY);
    }
    checkBackendStatus();
  }

  function checkBackendStatus() {
    configureBackendPanel();
    els.backendStatus.textContent = hasLiveBackend() ? "eBay: check" : "eBay: setup";
    els.backendStatus.className = "status-pill";
    api("/api/config")
      .then(function (config) {
        els.backendStatus.textContent = config.ebayConfigured ? "eBay: live" : "eBay: keys";
        els.backendStatus.classList.toggle("live", Boolean(config.ebayConfigured));
        els.backendStatus.classList.toggle("warn", !config.ebayConfigured);
      })
      .catch(function () {
        els.backendStatus.textContent = hasLiveBackend() ? "eBay: offline" : "eBay: setup";
        els.backendStatus.classList.add("warn");
      });
  }

  function configureBackendPanel() {
    if (!els.backendPanel) return;
    var showSettings = new URLSearchParams(window.location.search).get("settings") === "1";
    els.backendPanel.classList.toggle("app-hidden", !showSettings);
  }

  function buildStaticEbayLookup(query) {
    var clean = cleanTitle(query);
    return {
      query: clean,
      source: "github_pages_links",
      estimatedPrice: 0,
      activeCount: 0,
      soldCount: 0,
      sellThroughRate: null,
      valueBucket: "check manually",
      score: scoreFor({ estimatedPrice: 0, sellThroughRate: null }),
      resaleDecision: "review",
      activeSample: [],
      soldSample: [],
      activeUrl: urlForLookup("active", clean),
      soldUrl: urlForLookup("sold", clean)
    };
  }

  function buildNoLookup(query, reason) {
    var lookup = buildStaticEbayLookup(query);
    lookup.source = "ocr_needs_rescan";
    lookup.valueBucket = "needs clearer title";
    lookup.noLookupReason = reason || "OCR was not clear enough to search eBay.";
    lookup.score = { color: "unknown", label: "Rescan", reason: "OCR title is too weak.", decision: "review" };
    lookup.resaleDecision = "review";
    return lookup;
  }

  function enrichLookup(lookup) {
    var clean = Object.assign({}, lookup || {});
    clean.estimatedPrice = moneyNumber(clean.estimatedPrice);
    clean.activeCount = Number(clean.activeCount || 0);
    clean.soldCount = Number(clean.soldCount || 0);
    if (clean.sellThroughRate === undefined || clean.sellThroughRate === null) {
      clean.sellThroughRate = calculateStr(clean);
    }
    clean.valueBucket = clean.valueBucket || bucketForPrice(clean.estimatedPrice);
    clean.score = clean.score || scoreFor(clean);
    clean.resaleDecision = clean.resaleDecision || clean.score.decision;
    return clean;
  }

  function loadLocalScans() {
    try {
      var scans = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(scans) ? scans : [];
    } catch (error) {
      return [];
    }
  }

  function persistLocalScans() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.scans.slice(0, 1000)));
  }

  function cryptoId() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return "scan-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function setProgress(value) {
    els.ocrProgress.value = value;
  }

  function setStatus(message) {
    els.ocrStatus.textContent = message;
  }

  function bucketForPrice(price) {
    var value = Number(price || 0);
    if (value >= 50) return "over $50";
    if (value >= 20) return "over $20";
    if (value >= 10) return "over $10";
    return "under $10";
  }

  function scoreFor(input) {
    var price = Number(input && input.estimatedPrice || 0);
    var rate = input && input.sellThroughRate;
    if (rate === undefined || rate === null || rate === "") {
      return {
        color: "unknown",
        label: "Needs data",
        reason: "Sold data is not connected yet.",
        decision: "review"
      };
    }
    rate = Number(rate || 0);
    if (rate >= 70 && price >= 50) {
      return { color: "gold", label: "Gold", reason: "STR above 70% and value above $50.", decision: "worth listing" };
    }
    if (rate >= 50 && price >= 20) {
      return { color: "green", label: "Green", reason: "STR above 50% and value above $20.", decision: "worth listing" };
    }
    if (rate > 10 && price >= 10) {
      return { color: "yellow", label: "Yellow", reason: "STR above 10% and value above $10.", decision: "review" };
    }
    return { color: "red", label: "Red", reason: "STR below 10% or value below $10.", decision: "skip" };
  }

  function calculateStr(input) {
    var sold = Number(input && input.soldCount || 0);
    var active = Number(input && input.activeCount || 0);
    if (!sold && !active) return null;
    return Math.round((sold / Math.max(sold + active, 1)) * 100);
  }

  function formatRate(value) {
    if (value === undefined || value === null || value === "") return "unknown";
    return Number(value || 0) + "%";
  }

  function moneyNumber(value) {
    var number = Number(String(value || "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function findMemoryMatch(title) {
    var target = titleKey(title);
    if (!target) return null;
    var targetWords = target.split(" ").filter(function (word) { return word.length > 2; });
    var best = null;
    var bestScore = 0;
    state.scans.forEach(function (scan) {
      var key = titleKey(scan.title);
      if (!key) return;
      var score = targetWords.reduce(function (count, word) {
        return count + (key.indexOf(word) !== -1 ? 1 : 0);
      }, 0);
      if (key === target) score += 4;
      if (score > bestScore) {
        bestScore = score;
        best = scan;
      }
    });
    return bestScore >= Math.max(2, Math.ceil(targetWords.length * 0.45)) ? best : null;
  }

  function memoryText(match) {
    if (!match) return "Memory: no match yet";
    var pieces = ["Memory: seen before"];
    if (match.createdAt) pieces.push(shortDate(match.createdAt));
    if (match.paidPrice) pieces.push("paid " + money(match.paidPrice));
    if (match.soldPrice) pieces.push("sold " + money(match.soldPrice));
    if (match.estimatedPrice) pieces.push("value " + money(match.estimatedPrice));
    if (match.decision) pieces.push(match.decision);
    return pieces.join(" - ");
  }

  function titleKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\b(the|a|an|and|of|for|vhs|dvd|blu ray|book|movie)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shortDate(value) {
    try {
      return new Date(value).toLocaleDateString();
    } catch (error) {
      return "";
    }
  }

  function money(value) {
    var number = Number(value || 0);
    return number ? "$" + number.toFixed(2) : "$0.00";
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char];
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(new URL("sw.js", window.location.href)).catch(function () {
        return null;
      });
    }
  }

  init();
})();
