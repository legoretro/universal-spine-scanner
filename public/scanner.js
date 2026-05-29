(function () {
  "use strict";

  var STORAGE_KEY = "universal-spine-scans-v1";
  var state = {
    itemType: "VHS",
    queue: [],
    currentIndex: -1,
    currentImage: null,
    currentFileName: "",
    rotation: 0,
    cropMode: "full",
    contrast: false,
    ocrRaw: "",
    currentLookup: null,
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
    ocrProgress: document.getElementById("ocrProgress"),
    ocrStatus: document.getElementById("ocrStatus"),
    cleanTitle: document.getElementById("cleanTitle"),
    subtitle: document.getElementById("subtitle"),
    barcode: document.getElementById("barcode"),
    condition: document.getElementById("condition"),
    sealed: document.getElementById("sealed"),
    decision: document.getElementById("decision"),
    notes: document.getElementById("notes"),
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
    state.scans = loadLocalScans();
    bindEvents();
    renderList();
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

    els.rotateLeft.addEventListener("click", function () {
      state.rotation = (state.rotation + 270) % 360;
      renderCanvas();
    });

    els.rotateRight.addEventListener("click", function () {
      state.rotation = (state.rotation + 90) % 360;
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
      els.emptyCanvas.style.display = "block";
      return;
    }
    var processed = makeProcessedCanvas();
    els.canvas.width = processed.width;
    els.canvas.height = processed.height;
    els.canvas.getContext("2d").drawImage(processed, 0, 0);
    els.canvas.style.display = "block";
    els.emptyCanvas.style.display = "none";
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
    if (!window.Tesseract) {
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
      imageName: state.currentFileName,
      lookupStatus: state.currentLookup ? state.currentLookup.valueBucket + " / " + state.currentLookup.source : "not looked up",
      decision: state.currentLookup && state.currentLookup.resaleDecision || els.decision.value,
      estimatedPrice: state.currentLookup && state.currentLookup.estimatedPrice || 0,
      sellThroughRate: state.currentLookup && state.currentLookup.sellThroughRate,
      activeCount: state.currentLookup && state.currentLookup.activeCount || 0,
      soldCount: state.currentLookup && state.currentLookup.soldCount || 0,
      valueBucket: state.currentLookup && state.currentLookup.valueBucket || bucketForPrice(0),
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
    api("/api/lookup-ebay?title=" + encodeURIComponent(query))
      .then(function (lookup) {
        state.currentLookup = lookup;
        if (lookup.resaleDecision) {
          els.decision.value = lookup.resaleDecision;
        }
        renderValueResult(lookup);
        setStatus("Value checked. Review the bucket and save when ready.");
      })
      .catch(function (error) {
        renderValueResult({ error: error.message, query: query });
        setStatus("Could not check value: " + error.message);
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
    var price = money(lookup.estimatedPrice || 0);
    var rate = lookup.sellThroughRate === null || lookup.sellThroughRate === undefined ? "unknown" : lookup.sellThroughRate + "%";
    var cls = lookup.resaleDecision === "worth listing" ? "value-result good" : lookup.resaleDecision === "skip" ? "value-result skip" : "value-result";
    els.valueResult.className = cls;
    els.valueResult.innerHTML =
      "<strong>" + escapeHtml(lookup.valueBucket || bucketForPrice(lookup.estimatedPrice)) + " - " + price + "</strong>" +
      "<span>Decision: " + escapeHtml(lookup.resaleDecision || "review") + " | active sample " + Number(lookup.activeCount || 0) + " | sold sample " + Number(lookup.soldCount || 0) + " | sell-through " + escapeHtml(rate) + "</span>" +
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
      api("/api/lookup-ebay?title=" + encodeURIComponent(query))
        .then(function (lookup) {
          window.open(type === "ebay-active" ? lookup.activeUrl : lookup.soldUrl, "_blank", "noopener");
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
        });
      return;
    }
    var urls = {
      google: "https://www.google.com/search?q=" + encodeURIComponent(query + " resale value"),
      amazon: "https://www.amazon.com/s?k=" + encodeURIComponent(barcode || query),
      manual: "https://www.google.com/search?q=" + encodeURIComponent(query)
    };
    window.open(urls[type], "_blank", "noopener");
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
      return (
        '<article class="scan-row">' +
          '<strong>' + escapeHtml(scan.title) + '</strong>' +
          '<div class="scan-meta">' + escapeHtml(scan.itemType) + " - " + escapeHtml(scan.condition || "used") + " - " + escapeHtml(scan.sealed || "open") + '</div>' +
          '<div class="decision-row">' +
            '<span class="decision-chip">' + escapeHtml(scan.decision || "scanned") + '</span>' +
            '<span class="decision-chip">' + escapeHtml(scan.valueBucket || bucketForPrice(scan.estimatedPrice)) + '</span>' +
            (scan.estimatedPrice ? '<span class="decision-chip">' + escapeHtml(money(scan.estimatedPrice)) + '</span>' : '') +
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
    return fetch(path, Object.assign({
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

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(function () {
        return null;
      });
    }
  }

  init();
})();
