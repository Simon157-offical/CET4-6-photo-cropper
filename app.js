(() => {
  const stage = document.querySelector('#crop-stage');
  const canvas = document.querySelector('#crop-canvas');
  const ctx = canvas.getContext('2d');
  const fileInput = document.querySelector('#file-input');
  const emptyState = document.querySelector('#empty-state');
  const editor = document.querySelector('#editor-content');
  const replaceLabel = document.querySelector('#replace-label');
  const slider = document.querySelector('#zoom-slider');
  const zoomValue = document.querySelector('#zoom-value');
  const exportButton = document.querySelector('#export-button');
  const status = document.querySelector('#status-message');
  const result = document.querySelector('#export-result');
  const resultImage = document.querySelector('#result-image');
  const resultMeta = document.querySelector('#result-meta');
  const download = document.querySelector('#download-link');
  const toast = document.querySelector('#toast');
  const MAX_BYTES = 200 * 1024;
  let image = null, imageUrl = '', resultUrl = '', zoom = 1, panX = 0, panY = 0;
  let dragging = false, lastX = 0, lastY = 0, toastTimer = 0;

  function bounds() {
    const base = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const scale = base * zoom;
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    panX = Math.max(canvas.width - width, Math.min(0, panX));
    panY = Math.max(canvas.height - height, Math.min(0, panY));
    return { scale, width, height };
  }

  function draw() {
    if (!image) return;
    bounds();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, panX, panY, ...[image.naturalWidth * Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight) * zoom, image.naturalHeight * Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight) * zoom]);
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  }

  function setZoom(value) {
    const next = Math.max(1, Math.min(3, Number(value)));
    if (image && next > zoom) {
      const old = bounds();
      const cx = canvas.width / 2 - panX, cy = canvas.height / 2 - panY;
      zoom = next;
      const current = bounds();
      panX = canvas.width / 2 - cx * current.scale / old.scale;
      panY = canvas.height / 2 - cy * current.scale / old.scale;
    } else zoom = next;
    slider.value = String(zoom);
    draw();
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function clearResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = '';
    result.hidden = true;
    download.hidden = true;
    download.removeAttribute('href');
  }

  function loadFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('请选择 JPG、PNG 或 WebP 图片。'); return; }
    if (file.size > 30 * 1024 * 1024) { showToast('图片超过 30 MB，请选择较小的文件。'); return; }
    const nextUrl = URL.createObjectURL(file);
    const nextImage = new Image();
    nextImage.onload = () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = nextUrl;
      image = nextImage;
      zoom = 1;
      const baseScale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      panX = (canvas.width - image.naturalWidth * baseScale) / 2;
      panY = (canvas.height - image.naturalHeight * baseScale) / 2;
      slider.value = '1';
      emptyState.hidden = true; editor.hidden = false; replaceLabel.hidden = false;
      exportButton.disabled = false;
      status.textContent = `${file.name} · 拖动照片调整构图`;
      clearResult(); draw();
    };
    nextImage.onerror = () => { URL.revokeObjectURL(nextUrl); showToast('无法读取这张图片，请换一张试试。'); };
    nextImage.src = nextUrl;
  }

  function pointerPosition(event) {
    const rect = stage.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
  }
  stage.addEventListener('pointerdown', event => {
    if (!image) return;
    dragging = true; stage.setPointerCapture(event.pointerId);
    const point = pointerPosition(event); lastX = point.x; lastY = point.y;
  });
  stage.addEventListener('pointermove', event => {
    if (!dragging) return;
    const point = pointerPosition(event); panX += point.x - lastX; panY += point.y - lastY;
    lastX = point.x; lastY = point.y; draw(); clearResult();
  });
  stage.addEventListener('pointerup', () => { dragging = false; });
  stage.addEventListener('pointercancel', () => { dragging = false; });
  slider.addEventListener('input', () => { setZoom(slider.value); clearResult(); });
  document.querySelector('#zoom-in').addEventListener('click', () => { setZoom(zoom + .1); clearResult(); });
  document.querySelector('#zoom-out').addEventListener('click', () => { setZoom(zoom - .1); clearResult(); });
  fileInput.addEventListener('change', () => { loadFile(fileInput.files[0]); fileInput.value = ''; });
  stage.addEventListener('dragover', event => event.preventDefault());
  stage.addEventListener('drop', event => { event.preventDefault(); loadFile(event.dataTransfer.files[0]); });
  document.querySelector('.editor-card').addEventListener('dragover', event => event.preventDefault());
  document.querySelector('.editor-card').addEventListener('drop', event => { event.preventDefault(); loadFile(event.dataTransfer.files[0]); });

  function encode(canvasToEncode, quality) {
    return new Promise(resolve => canvasToEncode.toBlob(resolve, 'image/jpeg', quality));
  }

  async function createCroppedJpeg() {
    bounds();
    const out = document.createElement('canvas'); out.width = 144; out.height = 192;
    const outCtx = out.getContext('2d', { alpha: false });
    const sx = -panX / bounds().scale, sy = -panY / bounds().scale;
    outCtx.fillStyle = '#fff'; outCtx.fillRect(0, 0, 144, 192);
    outCtx.drawImage(image, sx, sy, canvas.width / bounds().scale, canvas.height / bounds().scale, 0, 0, 144, 192);
    let low = .1, high = .94, best = null;
    for (let i = 0; i < 9; i++) {
      const quality = i === 0 ? high : (low + high) / 2;
      const blob = await encode(out, quality);
      if (!blob || blob.type !== 'image/jpeg') throw new Error('此浏览器暂不支持 JPG 导出，请换用最新版浏览器。');
      if (blob.size <= MAX_BYTES) { best = blob; low = quality; } else high = quality;
    }
    if (!best) {
      const smallest = await encode(out, .05);
      if (smallest && smallest.type === 'image/jpeg' && smallest.size <= MAX_BYTES) best = smallest;
    }
    if (!best) throw new Error('照片无法压缩到 200 KB 以内，请换一张照片再试。');
    return best;
  }

  exportButton.addEventListener('click', async () => {
    if (!image) return;
    exportButton.disabled = true;
    exportButton.querySelector('span:first-child').textContent = '正在优化照片…';
    status.textContent = '正在生成 144 × 192 JPG';
    try {
      const blob = await createCroppedJpeg();
      clearResult(); resultUrl = URL.createObjectURL(blob);
      resultImage.src = resultUrl;
      resultMeta.textContent = `144 × 192 px · JPG · ${(blob.size / 1024).toFixed(1)} KB`;
      result.hidden = false; download.href = resultUrl; download.hidden = false;
      status.textContent = '已符合照片尺寸与大小要求';
    } catch (error) { status.textContent = error.message; showToast(error.message); }
    finally { exportButton.disabled = false; exportButton.querySelector('span:first-child').textContent = '重新生成照片'; }
  });

  window.addEventListener('beforeunload', () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  });
})();

