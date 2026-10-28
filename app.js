(() => {
  const $ = selector => document.querySelector(selector);
  const stage = $('#crop-stage'), canvas = $('#crop-canvas'), ctx = canvas.getContext('2d');
  const fileInput = $('#file-input'), emptyState = $('#empty-state'), editor = $('#editor-content');
  const slider = $('#zoom-slider'), zoomValue = $('#zoom-value'), exportButton = $('#export-button');
  const status = $('#status-message'), result = $('#export-result'), resultImage = $('#result-image');
  const resultMeta = $('#result-meta'), download = $('#download-link'), toast = $('#toast');
  const ratioSelect = $('#ratio-select'), sizePreset = $('#size-preset'), widthInput = $('#output-width');
  const heightInput = $('#output-height'), ratioLock = $('#ratio-lock'), formatSelect = $('#format-select');
  const limitToggle = $('#size-limit'), estimateLabel = $('#size-estimate'), MAX_BYTES = 200 * 1024;
  const formats = { jpeg: { mime: 'image/jpeg', extension: 'jpg', quality: true }, png: { mime: 'image/png', extension: 'png', quality: false }, webp: { mime: 'image/webp', extension: 'webp', quality: true } };
  let image = null, imageUrl = '', resultUrl = '', zoom = 1, panX = 0, panY = 0;
  let dragging = false, pointers = new Map(), pinch = null, toastTimer = 0, estimateTimer = 0, estimateVersion = 0;
  let customRatio = 3 / 4, lockRatio = true;

  function dimensions() { return { width: Number(widthInput.value), height: Number(heightInput.value) }; }
  function cropRatio() {
    if (ratioSelect.value === 'custom') return customRatio;
    const [w, h] = ratioSelect.value.split(':').map(Number);
    return w / h;
  }
  function baseScale() { return Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight); }
  function bounds() {
    const scale = baseScale() * zoom;
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    panX = Math.max(canvas.width - width, Math.min(0, panX));
    panY = Math.max(canvas.height - height, Math.min(0, panY));
    return { scale, width, height };
  }
  function draw() {
    if (!image) return;
    const b = bounds();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, panX, panY, b.width, b.height);
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  }
  function zoomAt(x, y, nextZoom) {
    if (!image) return;
    const old = bounds();
    const sourceX = (x - panX) / old.scale, sourceY = (y - panY) / old.scale;
    zoom = Math.max(1, Math.min(4, nextZoom));
    const newScale = baseScale() * zoom;
    panX = x - sourceX * newScale;
    panY = y - sourceY * newScale;
    slider.value = String(zoom);
    draw(); clearResult(); scheduleEstimate();
  }
  function zoomCenter(value) { zoomAt(canvas.width / 2, canvas.height / 2, value); }
  function showToast(message) {
    toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }
  function clearResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = ''; result.hidden = true; download.hidden = true; download.removeAttribute('href');
  }
  function setRatio(value, preserveFocus = true) {
    let focusX = image ? (canvas.width / 2 - panX) / bounds().scale : null;
    let focusY = image ? (canvas.height / 2 - panY) / bounds().scale : null;
    if (value !== 'custom') {
      const [w, h] = value.split(':').map(Number); customRatio = w / h;
    }
    const ratio = cropRatio();
    canvas.height = Math.round(canvas.width / ratio);
    stage.style.aspectRatio = `1 / ${canvas.height / canvas.width}`;
    $('.stage-badge').textContent = `${ratioSelect.options[ratioSelect.selectedIndex].text.split('·')[0].trim()} 裁切框`;
    if (image) {
      const scale = baseScale() * zoom;
      if (preserveFocus && focusX !== null) {
        panX = canvas.width / 2 - focusX * scale;
        panY = canvas.height / 2 - focusY * scale;
      } else { panX = (canvas.width - image.naturalWidth * scale) / 2; panY = (canvas.height - image.naturalHeight * scale) / 2; }
      draw(); clearResult(); scheduleEstimate();
    }
  }
  function setDimensions(width, height, fromWidth) {
    const w = Math.max(1, Math.min(10000, Math.round(Number(width) || 1)));
    const h = Math.max(1, Math.min(10000, Math.round(Number(height) || 1)));
    if (lockRatio) {
      const ratio = cropRatio();
      if (fromWidth) heightInput.value = String(Math.max(1, Math.round(w / ratio)));
      else widthInput.value = String(Math.max(1, Math.round(h * ratio)));
    }
    sizePreset.value = 'custom';
    clearResult(); scheduleEstimate();
  }
  function pointerPosition(event) {
    const rect = stage.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
  }
  function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function startPinch() {
    const entries = [...pointers.values()];
    if (entries.length < 2) { pinch = null; return; }
    const center = midpoint(entries[0], entries[1]), b = bounds();
    pinch = { distance: Math.max(1, distance(entries[0], entries[1])), zoom, center,
      sourceX: (center.x - panX) / b.scale, sourceY: (center.y - panY) / b.scale };
  }
  function onPointerDown(event) {
    if (!image) return;
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, pointerPosition(event));
    if (pointers.size >= 2) startPinch();
    else { dragging = true; }
  }
  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    const point = pointerPosition(event), previous = pointers.get(event.pointerId);
    pointers.set(event.pointerId, point);
    if (pointers.size >= 2) {
      if (!pinch) startPinch();
      const [a, b] = [...pointers.values()], center = midpoint(a, b);
      zoom = Math.max(1, Math.min(4, pinch.zoom * distance(a, b) / pinch.distance));
      const scale = baseScale() * zoom;
      panX = center.x - pinch.sourceX * scale; panY = center.y - pinch.sourceY * scale;
      slider.value = String(zoom); draw(); clearResult(); scheduleEstimate();
    } else if (dragging) {
      panX += point.x - previous.x; panY += point.y - previous.y;
      draw(); clearResult(); scheduleEstimate();
    }
  }
  function onPointerEnd(event) {
    pointers.delete(event.pointerId);
    if (pointers.size >= 2) startPinch(); else { dragging = false; pinch = null; }
  }

  function encode(canvasToEncode, format, quality) {
    return new Promise(resolve => canvasToEncode.toBlob(resolve, formats[format].mime, quality));
  }
  async function renderOutput({ width, height, format, limitEnabled }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 10000 || height > 10000 || width * height > 24000000) {
      throw new Error('分辨率无效或过大，请将单边设为 10000 px 以内、总像素设为 2400 万以内。');
    }
    const out = document.createElement('canvas'); out.width = width; out.height = height;
    const outCtx = out.getContext('2d', { alpha: format !== 'jpeg' });
    if (!outCtx) throw new Error('浏览器无法创建输出画布，请换用最新版浏览器。');
    const b = bounds();
    if (format === 'jpeg') { outCtx.fillStyle = '#fff'; outCtx.fillRect(0, 0, width, height); }
    outCtx.drawImage(image, -panX / b.scale, -panY / b.scale, canvas.width / b.scale, canvas.height / b.scale, 0, 0, width, height);
    const capEnabled = limitEnabled && formats[format].quality;
    if (!capEnabled) {
      const blob = await encode(out, format, format === 'png' ? undefined : .92);
      if (!blob || blob.type !== formats[format].mime) throw new Error(`${format.toUpperCase()} 导出暂不受此浏览器支持。`);
      return blob;
    }
    let low = .04, high = .95, best = null;
    for (let i = 0; i < 10; i++) {
      const quality = i === 0 ? high : (low + high) / 2;
      const blob = await encode(out, format, quality);
      if (!blob || blob.type !== formats[format].mime) throw new Error(`${format.toUpperCase()} 导出暂不受此浏览器支持。`);
      if (blob.size <= MAX_BYTES) { best = blob; low = quality; } else high = quality;
    }
    if (!best) {
      const blob = await encode(out, format, .02);
      if (blob && blob.size <= MAX_BYTES) best = blob;
    }
    return best || await encode(out, format, .02);
  }
  function currentSettings() {
    const { width, height } = dimensions();
    return { width, height, format: formatSelect.value, limitEnabled: limitToggle.checked };
  }
  function scheduleEstimate() {
    if (!image) return;
    const version = ++estimateVersion;
    clearTimeout(estimateTimer);
    estimateLabel.textContent = '计算中…'; estimateLabel.classList.remove('over-limit');
    estimateTimer = setTimeout(async () => {
      try {
        const blob = await renderOutput(currentSettings());
        if (version !== estimateVersion) return;
        const over = limitToggle.checked && blob.size > MAX_BYTES;
        estimateLabel.textContent = `约 ${(blob.size / 1024).toFixed(1)} KB${over ? ' · 超出上限' : ''}`;
        estimateLabel.classList.toggle('over-limit', over);
        exportButton.disabled = over;
        if (over) status.textContent = formatSelect.value === 'png' ? 'PNG 为无损格式；可关闭大小限制，或降低输出分辨率。' : '当前设置下无法压到 200 KB，请降低分辨率或关闭限制。';
        else status.textContent = limitToggle.checked ? '将尽量满足 200 KB 上限' : '文件大小限制已关闭';
      } catch (error) {
        if (version !== estimateVersion) return;
        estimateLabel.textContent = '无法估算'; exportButton.disabled = true; status.textContent = error.message;
      }
    }, 450);
  }
  function loadFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('请选择 JPG、PNG 或 WebP 图片。'); return; }
    if (file.size > 30 * 1024 * 1024) { showToast('图片超过 30 MB，请选择较小的文件。'); return; }
    const nextUrl = URL.createObjectURL(file), nextImage = new Image();
    nextImage.onload = () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = nextUrl; image = nextImage; zoom = 1;
      setRatio(ratioSelect.value, false);
      const b = bounds(); panX = (canvas.width - b.width) / 2; panY = (canvas.height - b.height) / 2;
      slider.value = '1'; emptyState.hidden = true; editor.hidden = false; $('#replace-label').hidden = false;
      exportButton.disabled = false; status.textContent = `${file.name} · 拖动照片调整构图`;
      clearResult(); draw(); scheduleEstimate();
    };
    nextImage.onerror = () => { URL.revokeObjectURL(nextUrl); showToast('无法读取这张图片，请换一张试试。'); };
    nextImage.src = nextUrl;
  }

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerEnd);
  stage.addEventListener('pointercancel', onPointerEnd);
  stage.addEventListener('wheel', event => {
    if (!image) return;
    event.preventDefault(); const p = pointerPosition(event);
    zoomAt(p.x, p.y, zoom * Math.exp(-event.deltaY * .002));
  }, { passive: false });
  slider.addEventListener('input', () => zoomCenter(Number(slider.value)));
  $('#zoom-in').addEventListener('click', () => zoomCenter(zoom + .1));
  $('#zoom-out').addEventListener('click', () => zoomCenter(zoom - .1));
  fileInput.addEventListener('change', () => { loadFile(fileInput.files[0]); fileInput.value = ''; });
  stage.addEventListener('dragover', event => event.preventDefault());
  stage.addEventListener('drop', event => { event.preventDefault(); loadFile(event.dataTransfer.files[0]); });
  $('.editor-card').addEventListener('dragover', event => event.preventDefault());
  $('.editor-card').addEventListener('drop', event => { event.preventDefault(); loadFile(event.dataTransfer.files[0]); });
  ratioSelect.addEventListener('change', () => {
    if (ratioSelect.value === 'custom') { customRatio = dimensions().width / Math.max(1, dimensions().height); }
    setRatio(ratioSelect.value);
    if (lockRatio) setDimensions(dimensions().width, dimensions().height, true);
  });
  sizePreset.addEventListener('change', () => {
    if (sizePreset.value === 'custom') return;
    const [w, h] = sizePreset.value.split('x').map(Number);
    widthInput.value = String(w); heightInput.value = String(h);
    if (ratioSelect.value !== 'custom') {
      const inferred = w / h;
      const matching = [...ratioSelect.options].find(option => option.value !== 'custom' && Math.abs(option.value.split(':').map(Number).reduce((a, b) => a / b) - inferred) < .01);
      if (matching) { ratioSelect.value = matching.value; setRatio(matching.value); }
    }
    clearResult(); scheduleEstimate();
  });
  widthInput.addEventListener('change', () => setDimensions(widthInput.value, heightInput.value, true));
  heightInput.addEventListener('change', () => setDimensions(widthInput.value, heightInput.value, false));
  ratioLock.addEventListener('click', () => {
    lockRatio = !lockRatio; ratioLock.setAttribute('aria-pressed', String(lockRatio));
    ratioLock.innerHTML = `${lockRatio ? '🔒' : '🔓'} <span>${lockRatio ? '锁定比例' : '自由尺寸'}</span>`;
    if (lockRatio) setDimensions(dimensions().width, dimensions().height, true);
  });
  formatSelect.addEventListener('change', () => { clearResult(); scheduleEstimate(); });
  limitToggle.addEventListener('change', () => { clearResult(); scheduleEstimate(); });

  exportButton.addEventListener('click', async () => {
    if (!image) return;
    exportButton.disabled = true; exportButton.querySelector('span:first-child').textContent = '正在生成…';
    status.textContent = '正在按所选规格生成文件';
    try {
      const settings = currentSettings(), blob = await renderOutput(settings);
      if (settings.limitEnabled && blob.size > MAX_BYTES) throw new Error(formatSelect.value === 'png' ? 'PNG 保持无损，此分辨率下会超过 200 KB。请降低分辨率或关闭大小限制。' : '当前图片无法压到 200 KB，请降低分辨率或关闭大小限制。');
      clearResult(); resultUrl = URL.createObjectURL(blob); resultImage.src = resultUrl;
      const format = formats[settings.format];
      resultMeta.textContent = `${settings.width} × ${settings.height} px · ${settings.format.toUpperCase()} · ${(blob.size / 1024).toFixed(1)} KB`;
      result.hidden = false; download.href = resultUrl; download.download = `cet-photo.${format.extension}`;
      download.textContent = `下载 ${format.extension.toUpperCase()} 照片 ↓`; download.hidden = false;
      status.textContent = '已生成，可下载到本地';
    } catch (error) { status.textContent = error.message; showToast(error.message); }
    finally { exportButton.querySelector('span:first-child').textContent = '生成照片'; scheduleEstimate(); }
  });
  window.addEventListener('beforeunload', () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  });
})();

