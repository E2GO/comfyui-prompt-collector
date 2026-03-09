// ── State ───────────────────────────────────────────────────────────────────
let allPrompts = [];
let allImagePaths = [];
let autoCopy = true;
let reversePositives = true; // default: longest first
let selectedImagePath = null; // original path of selected image
let highlightedPromptText = null; // track which prompt is highlighted

// ── DOM References ──────────────────────────────────────────────────────────
const btnSelectFolder = document.getElementById('btn-select-folder');
const folderPath = document.getElementById('folder-path');
const filterPositive = document.getElementById('filter-positive');
const filterNegative = document.getElementById('filter-negative');
const filterTrigger = document.getElementById('filter-trigger');
const searchInput = document.getElementById('search-input');
const promptCount = document.getElementById('prompt-count');
const btnAutocopy = document.getElementById('btn-autocopy');
const btnExport = document.getElementById('btn-export');
const exportMenu = document.getElementById('export-menu');
const promptList = document.getElementById('prompt-list');
const galleryGrid = document.getElementById('gallery-grid');
const gallerySelectedName = document.getElementById('gallery-selected-name');
const btnShowInFolder = document.getElementById('btn-show-in-folder');
const gallerySizeSlider = document.getElementById('gallery-size-slider');
const gallerySizeValue = document.getElementById('gallery-size-value');
const statusText = document.getElementById('status-text');
const toast = document.getElementById('toast');

// ── Utilities ───────────────────────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function basename(p) {
  return p.split(/[/\\]/).pop();
}

function normalizePath(p) {
  return p.replace(/\\/g, '/').toLowerCase();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), 1500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied!');
  } catch {
    showToast('Copy failed');
  }
}

function selectImage(originalPath) {
  selectedImagePath = originalPath || null;
  if (selectedImagePath) {
    gallerySelectedName.textContent = basename(selectedImagePath);
    btnShowInFolder.classList.remove('hidden');
  } else {
    gallerySelectedName.textContent = 'No image selected';
    btnShowInFolder.classList.add('hidden');
  }
}

function pathToThumbUrl(p) {
  return 'thumb:///' + p.replace(/\\/g, '/');
}

// ── Grouping: by image (all prompts for same image together) ────────────────

function buildImageGroups() {
  // Step 1: for each image, collect all its prompts by type
  const imageMap = new Map(); // normalized path → { positives, negatives, triggers, sources }

  for (const p of allPrompts) {
    for (const src of p.sources) {
      const key = normalizePath(src);
      if (!imageMap.has(key)) {
        imageMap.set(key, { positives: [], negatives: [], triggers: [], sources: [src] });
      }
      const entry = imageMap.get(key);
      if (p.type === 'positive') entry.positives.push(p.text);
      else if (p.type === 'negative') entry.negatives.push(p.text);
      else if (p.type === 'trigger') entry.triggers.push(p.text);
    }
  }

  // Step 2: deduplicate — merge images that have identical prompt sets
  const groupMap = new Map(); // fingerprint → group
  for (const [normPath, data] of imageMap) {
    const fingerprint = JSON.stringify({
      p: [...data.positives].sort(),
      n: [...data.negatives].sort(),
      t: [...data.triggers].sort(),
    });
    if (groupMap.has(fingerprint)) {
      groupMap.get(fingerprint).sources.push(data.sources[0]);
    } else {
      groupMap.set(fingerprint, {
        positives: data.positives,
        negatives: data.negatives,
        triggers: data.triggers,
        sources: [data.sources[0]],
      });
    }
  }

  return Array.from(groupMap.values());
}

// ── Filtering ───────────────────────────────────────────────────────────────

function getFilteredGroups() {
  const query = searchInput.value.trim().toLowerCase();
  const groups = buildImageGroups();

  return groups.filter((g) => {
    // At least one visible prompt type must be present
    const hasVisible =
      (filterPositive.checked && g.positives.length > 0) ||
      (filterNegative.checked && g.negatives.length > 0) ||
      (filterTrigger.checked && g.triggers.length > 0);
    if (!hasVisible) return false;

    // Search filter
    if (query) {
      const allTexts = [...g.positives, ...g.negatives, ...g.triggers];
      if (!allTexts.some((t) => t.toLowerCase().includes(query))) return false;
    }
    return true;
  });
}

// ── Render Prompts ──────────────────────────────────────────────────────────

function renderPrompts() {
  const filtered = getFilteredGroups();
  promptCount.textContent = `${filtered.length} groups`;
  const prevScroll = promptList.scrollTop;

  if (filtered.length === 0) {
    promptList.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<p>No prompts match the current filters.</p>';
    promptList.appendChild(empty);
    return;
  }

  promptList.innerHTML = '';

  filtered.forEach((group) => {
    const item = document.createElement('div');
    item.className = 'prompt-item';
    const normSources = group.sources.map(normalizePath);
    item.dataset.sources = JSON.stringify(normSources);
    // Use first source path as unique group identity for highlight persistence
    const groupId = normSources[0] || '';
    item.dataset.groupId = groupId;
    if (highlightedPromptText === groupId) {
      item.classList.add('highlight');
    }

    let html = '';

    // Sub-cards container
    html += `<div class="sub-cards">`;

    // Source info bar
    html += `<div class="source-info">${group.sources.length} image(s) &middot; ${escapeHtml(basename(group.sources[0]))}</div>`;

    // Positive sub-cards
    if (filterPositive.checked) {
      const positives = reversePositives
        ? [...group.positives].sort((a, b) => b.length - a.length)
        : [...group.positives].sort((a, b) => a.length - b.length);
      for (const text of positives) {
        html += `
          <div class="sub-card sub-card-positive">
            <div class="sub-card-header">
              <span class="type-badge type-positive">positive</span>
              <span class="meta-spacer"></span>
              <button class="btn-copy" title="Copy prompt">&#128203;</button>
            </div>
            <div class="prompt-text">${escapeHtml(text)}</div>
          </div>`;
      }
    }

    // Trigger sub-cards
    if (filterTrigger.checked) {
      for (const text of group.triggers) {
        html += `
          <div class="sub-card sub-card-trigger">
            <div class="sub-card-header">
              <span class="type-badge type-trigger">trigger</span>
              <span class="meta-spacer"></span>
              <button class="btn-copy" title="Copy trigger">&#128203;</button>
            </div>
            <div class="prompt-text">${escapeHtml(text)}</div>
          </div>`;
      }
    }

    // Negative sub-cards
    if (filterNegative.checked) {
      for (const text of group.negatives) {
        html += `
          <div class="sub-card sub-card-negative">
            <div class="sub-card-header">
              <span class="type-badge type-negative">negative</span>
              <span class="meta-spacer"></span>
              <button class="btn-copy" title="Copy negative">&#128203;</button>
            </div>
            <div class="prompt-text negative-text">${escapeHtml(text)}</div>
          </div>`;
      }
    }

    html += `</div>`; // close sub-cards

    // Scroll-to-image button on the right
    html += `<button class="btn-scroll-to-img" title="Scroll to image">&#127912;</button>`;

    item.innerHTML = html;

    // Scroll-to-image button
    item.querySelector('.btn-scroll-to-img').addEventListener('click', (e) => {
      e.stopPropagation();
      // Clear old prompt highlights
      promptList.querySelectorAll('.prompt-item.highlight').forEach((el) => el.classList.remove('highlight'));
      // Highlight this prompt card
      item.classList.add('highlight');
      highlightedPromptText = item.dataset.groupId || null;

      // Clear old thumbnail highlights and find matching thumb
      const thumbs = galleryGrid.querySelectorAll('.gallery-thumb');
      let found = null;
      thumbs.forEach((t) => {
        t.classList.remove('active');
        if (!found && normSources.includes(t.dataset.path)) {
          found = t;
        }
      });
      if (found) {
        found.classList.add('active');
        found.scrollIntoView({ behavior: 'smooth', block: 'center' });
        selectImage(group.sources[0]);
      }
    });

    // Copy buttons — each copies the text from its own sub-card
    item.querySelectorAll('.btn-copy').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const subCard = btn.closest('.sub-card');
        const text = subCard.querySelector('.prompt-text').textContent;
        copyText(text);
      });
    });

    promptList.appendChild(item);
  });

  // Restore scroll position after filter toggle
  promptList.scrollTop = prevScroll;
}

// ── Gallery ─────────────────────────────────────────────────────────────────

function updateThumbSize() {
  const cols = parseInt(gallerySizeSlider.value, 10);
  gallerySizeValue.textContent = cols;
  // Calculate thumb size based on gallery width and desired columns
  // 420px panel - 12px padding - (cols-1)*4px gaps
  const availableWidth = galleryGrid.clientWidth - 12;
  const size = Math.floor((availableWidth - (cols - 1) * 4) / cols);
  galleryGrid.style.setProperty('--thumb-size', size + 'px');
}

function renderGallery() {
  galleryGrid.innerHTML = '';

  if (allImagePaths.length === 0) {
    galleryGrid.innerHTML = '<div class="empty-state"><p>No images</p></div>';
    return;
  }

  // Build all thumb containers first (no images yet)
  const fragment = document.createDocumentFragment();
  allImagePaths.forEach((imgPath) => {
    const thumb = document.createElement('div');
    thumb.className = 'gallery-thumb';
    thumb.dataset.path = normalizePath(imgPath);
    thumb.dataset.thumbSrc = pathToThumbUrl(imgPath);
    fragment.appendChild(thumb);

    thumb.addEventListener('click', () => onGalleryImageClick(imgPath, thumb));
  });
  galleryGrid.appendChild(fragment);

  updateThumbSize();

  // Lazy load with IntersectionObserver — only load visible thumbnails
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const el = entry.target;
          observer.unobserve(el);
          const img = document.createElement('img');
          img.decoding = 'async';
          img.src = el.dataset.thumbSrc;
          el.appendChild(img);
        }
      }
    },
    { root: galleryGrid, rootMargin: '300px' }
  );

  galleryGrid.querySelectorAll('.gallery-thumb').forEach((el) => observer.observe(el));
}

function onGalleryImageClick(imgPath, thumbEl) {
  const normalizedClick = normalizePath(imgPath);

  // Highlight active thumbnail
  galleryGrid.querySelectorAll('.gallery-thumb.active').forEach((el) => el.classList.remove('active'));
  thumbEl.classList.add('active');
  selectImage(imgPath);

  // Find prompts belonging to this image and scroll to first one
  const promptItems = promptList.querySelectorAll('.prompt-item');
  let firstMatch = null;

  promptItems.forEach((item) => {
    item.classList.remove('highlight');
    const sources = JSON.parse(item.dataset.sources || '[]');
    if (sources.includes(normalizedClick)) {
      item.classList.add('highlight');
      if (!firstMatch) firstMatch = item;
    }
  });

  if (firstMatch) {
    highlightedPromptText = firstMatch.dataset.groupId || null;
    firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (autoCopy) {
      const text = firstMatch.querySelector('.prompt-text').textContent;
      copyText(text);
    }
  } else {
    highlightedPromptText = null;
    showToast('No prompts for this image');
  }
}

// ── Select Folder ───────────────────────────────────────────────────────────

let scanning = false;

async function selectAndScanFolder() {
  if (scanning) return;
  const folder = await window.api.selectFolder();
  if (!folder) return;

  scanning = true;
  btnSelectFolder.disabled = true;
  folderPath.textContent = folder;
  statusText.textContent = 'Scanning...';
  promptList.innerHTML = '<div class="empty-state"><p>Scanning...</p></div>';
  galleryGrid.innerHTML = '<div class="empty-state"><p>Loading images...</p></div>';
  btnExport.disabled = true;
  await window.api.clearThumbCache();

  try {
    const result = await window.api.scanFolder(folder);
    allPrompts = result.prompts;
    allImagePaths = result.imagePaths;
    statusText.textContent = `Done: ${allPrompts.length} prompts from ${allImagePaths.length} images`;
    btnExport.disabled = allPrompts.length === 0;
    renderPrompts();
    renderGallery();
  } catch (err) {
    statusText.textContent = 'Scan failed';
    showToast('Scan error');
  } finally {
    scanning = false;
    btnSelectFolder.disabled = false;
  }
}

btnSelectFolder.addEventListener('click', selectAndScanFolder);

// ── Progress Listener ───────────────────────────────────────────────────────

window.api.onScanProgress(({ scanned, total }) => {
  statusText.textContent = `Scanning: ${scanned} / ${total} files...`;
});

// ── Filter Checkboxes ───────────────────────────────────────────────────────

filterPositive.addEventListener('change', renderPrompts);
filterNegative.addEventListener('change', renderPrompts);
filterTrigger.addEventListener('change', renderPrompts);

let searchTimeout;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(renderPrompts, 200);
});

// ── Gallery Size Slider ─────────────────────────────────────────────────────

gallerySizeSlider.addEventListener('input', updateThumbSize);

// ── Sort Order Toggle ───────────────────────────────────────────────────────

const btnSortOrder = document.getElementById('btn-sort-order');

function toggleSortOrder() {
  reversePositives = !reversePositives;
  btnSortOrder.classList.toggle('active', reversePositives);
  showToast(reversePositives ? 'Long first' : 'Short first');
  renderPrompts();
}

btnSortOrder.addEventListener('click', toggleSortOrder);

// ── Auto-copy Toggle ────────────────────────────────────────────────────────

btnAutocopy.addEventListener('click', () => {
  autoCopy = !autoCopy;
  btnAutocopy.classList.toggle('active', autoCopy);
  showToast(autoCopy ? 'Auto-copy ON' : 'Auto-copy OFF');
});

// ── Export Dropdown ─────────────────────────────────────────────────────────

btnExport.addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  exportMenu.classList.add('hidden');
});

async function exportAs(format) {
  const groups = getFilteredGroups();
  const prompts = [];
  for (const g of groups) {
    for (const text of g.positives) prompts.push({ type: 'positive', text, sources: g.sources });
    for (const text of g.triggers) prompts.push({ type: 'trigger', text, sources: g.sources });
    for (const text of g.negatives) prompts.push({ type: 'negative', text, sources: g.sources });
  }
  const result = await window.api.exportPrompts({ prompts, format });
  if (result) showToast(`Exported as ${format.toUpperCase()}`);
}

document.querySelectorAll('.export-option[data-format]').forEach((btn) => {
  btn.addEventListener('click', () => {
    exportMenu.classList.add('hidden');
    exportAs(btn.getAttribute('data-format'));
  });
});

// ── Show in Folder ─────────────────────────────────────────────────────────

btnShowInFolder.addEventListener('click', () => {
  if (selectedImagePath) window.api.showInFolder(selectedImagePath);
});

// ── Open Logs ──────────────────────────────────────────────────────────────

document.getElementById('btn-open-logs').addEventListener('click', () => {
  window.api.openLogFolder();
});

// ── Menu Events ────────────────────────────────────────────────────────────

window.api.onMenuSelectFolder(selectAndScanFolder);
window.api.onMenuExport((format) => exportAs(format));
window.api.onMenuToggleSort(toggleSortOrder);
