// ── State ──
const state = {
  paragraphs: [],     // { text, pageNum, index }
  currentIndex: 0,
  isPlaying: false,
  isPaused: false,
  docId: null,        // filename + size hash
  docName: '',
  speed: 1,
  pitch: 1,
  selectedVoice: null,
  voices: [],
  utterance: null,
};

// ── DOM refs ──
const $ = (sel) => document.querySelector(sel);
const landing = $('#landing');
const reader = $('#reader');
const fileInput = $('#file-input');
const btnPlay = $('#btn-play');
const btnPrev = $('#btn-prev');
const btnNext = $('#btn-next');
const btnStop = $('#btn-stop');
const btnBack = $('#btn-back');
const btnBookmark = $('#btn-bookmark');
const btnSettings = $('#btn-settings');
const btnDarkMode = $('#btn-dark-mode');
const iconPlay = $('#icon-play');
const iconPause = $('#icon-pause');
const voiceSelect = $('#voice-select');
const speedSelect = $('#speed-select');
const pitchSelect = $('#pitch-select');
const settingsPanel = $('#settings-panel');
const textDisplay = $('#text-display');
const paragraphsContainer = $('#paragraphs-container');
const loadingIndicator = $('#loading-indicator');
const docTitle = $('#doc-title');
const docProgress = $('#doc-progress');
const bookmarkList = $('#bookmark-list');
const recentBookmarks = $('#recent-bookmarks');

// ── PDF.js CDN ──
const PDFJS_VERSION = '3.11.174';
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

// ── Init ──
function init() {
  loadPreferences();
  loadVoices();
  setupEvents();
  showBookmarks();
}

// ── Dark mode ──
function loadPreferences() {
  const theme = localStorage.getItem('pdfr-theme');
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  const savedSpeed = localStorage.getItem('pdfr-speed');
  if (savedSpeed) {
    state.speed = parseFloat(savedSpeed);
    speedSelect.value = savedSpeed;
  }
  const savedPitch = localStorage.getItem('pdfr-pitch');
  if (savedPitch) {
    state.pitch = parseFloat(savedPitch);
    pitchSelect.value = savedPitch;
  }
}

function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('pdfr-theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('pdfr-theme', 'dark');
  }
}

// ── Voices ──
function loadVoices() {
  const populateVoices = () => {
    state.voices = speechSynthesis.getVoices();
    voiceSelect.innerHTML = '';

    if (state.voices.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'Default voice';
      opt.value = '';
      voiceSelect.appendChild(opt);
      return;
    }

    // Group by language
    const groups = {};
    state.voices.forEach((v, i) => {
      const lang = v.lang.split('-')[0].toUpperCase();
      if (!groups[lang]) groups[lang] = [];
      groups[lang].push({ voice: v, index: i });
    });

    // Sort language groups, English and Spanish first
    const sortedLangs = Object.keys(groups).sort((a, b) => {
      if (a === 'EN') return -1;
      if (b === 'EN') return 1;
      if (a === 'ES') return -1;
      if (b === 'ES') return 1;
      return a.localeCompare(b);
    });

    sortedLangs.forEach(lang => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = lang;
      groups[lang].forEach(({ voice, index }) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = `${voice.name} (${voice.lang})`;
        optgroup.appendChild(opt);
      });
      voiceSelect.appendChild(optgroup);
    });

    // Restore saved voice
    const savedVoice = localStorage.getItem('pdfr-voice');
    if (savedVoice) {
      const idx = state.voices.findIndex(v => v.name === savedVoice);
      if (idx >= 0) voiceSelect.value = idx;
    }

    updateSelectedVoice();
  };

  populateVoices();
  speechSynthesis.onvoiceschanged = populateVoices;
}

function updateSelectedVoice() {
  const idx = parseInt(voiceSelect.value);
  state.selectedVoice = isNaN(idx) ? null : state.voices[idx];
}

// ── Events ──
function setupEvents() {
  fileInput.addEventListener('change', handleFileSelect);
  btnPlay.addEventListener('click', togglePlayPause);
  btnPrev.addEventListener('click', prevParagraph);
  btnNext.addEventListener('click', nextParagraph);
  btnStop.addEventListener('click', stopReading);
  btnBack.addEventListener('click', goBack);
  btnBookmark.addEventListener('click', saveBookmark);
  btnSettings.addEventListener('click', toggleSettings);
  btnDarkMode.addEventListener('click', toggleDarkMode);

  voiceSelect.addEventListener('change', () => {
    updateSelectedVoice();
    if (state.selectedVoice) {
      localStorage.setItem('pdfr-voice', state.selectedVoice.name);
    }
    // Restart current paragraph with new voice if playing
    if (state.isPlaying) {
      speechSynthesis.cancel();
      speakCurrent();
    }
  });

  speedSelect.addEventListener('change', () => {
    state.speed = parseFloat(speedSelect.value);
    localStorage.setItem('pdfr-speed', speedSelect.value);
    if (state.isPlaying) {
      speechSynthesis.cancel();
      speakCurrent();
    }
  });

  pitchSelect.addEventListener('change', () => {
    state.pitch = parseFloat(pitchSelect.value);
    localStorage.setItem('pdfr-pitch', pitchSelect.value);
    if (state.isPlaying) {
      speechSynthesis.cancel();
      speakCurrent();
    }
  });

  // Handle file picker keyboard accessibility
  $('#file-picker-label').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  // iOS Safari: keep speech synthesis alive
  // Safari pauses synthesis if there's no user interaction for a while
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.isPlaying && !state.isPaused) {
      // Check if speech stopped unexpectedly
      if (!speechSynthesis.speaking && !speechSynthesis.pending) {
        speakCurrent();
      }
    }
  });
}

// ── File handling ──
async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  state.docName = file.name;
  state.docId = `${file.name}_${file.size}`;

  showScreen('reader');
  docTitle.textContent = file.name.replace(/\.pdf$/i, '');
  loadingIndicator.classList.remove('hidden');
  paragraphsContainer.innerHTML = '';

  try {
    await loadPdfJs();
    const paragraphs = await extractText(file);
    state.paragraphs = paragraphs;
    renderParagraphs();
    loadingIndicator.classList.add('hidden');

    // Check for existing bookmark
    const bookmark = getBookmark(state.docId);
    if (bookmark) {
      state.currentIndex = Math.min(bookmark.index, state.paragraphs.length - 1);
      highlightParagraph(state.currentIndex);
      scrollToParagraph(state.currentIndex);
      updateProgress();
    }
  } catch (err) {
    loadingIndicator.classList.add('hidden');
    paragraphsContainer.innerHTML = `<p class="paragraph" style="color: #e53935;">Error loading PDF: ${err.message}</p>`;
  }

  // Reset file input so same file can be re-selected
  fileInput.value = '';
}

// ── Load pdf.js dynamically ──
function loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = `${PDFJS_CDN}/pdf.min.js`;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load PDF.js library'));
    document.head.appendChild(script);
  });
}

// ── Extract text ──
async function extractText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const paragraphs = [];
  let globalIndex = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Group text items into paragraphs by detecting gaps
    let currentParagraph = '';
    let lastY = null;

    textContent.items.forEach(item => {
      if (!item.str.trim() && !currentParagraph.trim()) return;

      const y = item.transform[5];

      if (lastY !== null && Math.abs(y - lastY) > 14) {
        // Line break detected - check if it's a paragraph break
        if (currentParagraph.trim()) {
          paragraphs.push({
            text: currentParagraph.trim(),
            pageNum,
            index: globalIndex++,
          });
          currentParagraph = '';
        }
      }

      if (currentParagraph && item.str.trim()) {
        // Add space between items on same line if needed
        const needsSpace = currentParagraph.length > 0 &&
          !currentParagraph.endsWith(' ') &&
          !currentParagraph.endsWith('-');
        if (needsSpace) currentParagraph += ' ';
      }

      currentParagraph += item.str;
      lastY = y;
    });

    // Push remaining text
    if (currentParagraph.trim()) {
      paragraphs.push({
        text: currentParagraph.trim(),
        pageNum,
        index: globalIndex++,
      });
    }

    // Add page separator (if not the last page)
    if (pageNum < pdf.numPages) {
      paragraphs.push({
        text: `--- Page ${pageNum} ---`,
        pageNum,
        index: globalIndex++,
        isPageBreak: true,
      });
    }
  }

  return paragraphs;
}

// ── Render paragraphs ──
function renderParagraphs() {
  paragraphsContainer.innerHTML = '';

  state.paragraphs.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = p.isPageBreak ? 'paragraph page-break' : 'paragraph';
    el.textContent = p.text;
    el.dataset.index = i;

    if (!p.isPageBreak) {
      el.addEventListener('click', () => {
        stopReading();
        state.currentIndex = i;
        highlightParagraph(i);
        updateProgress();
        speakCurrent();
        setPlayingUI(true);
      });
    }

    paragraphsContainer.appendChild(el);
  });

  updateProgress();
}

// ── Highlight / scroll ──
function highlightParagraph(index) {
  document.querySelectorAll('.paragraph.active').forEach(el => el.classList.remove('active'));
  const el = paragraphsContainer.querySelector(`[data-index="${index}"]`);
  if (el) el.classList.add('active');
}

function scrollToParagraph(index) {
  const el = paragraphsContainer.querySelector(`[data-index="${index}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function updateProgress() {
  const readable = state.paragraphs.filter(p => !p.isPageBreak);
  const currentReadable = readable.findIndex(p => p.index >= state.currentIndex) + 1;
  docProgress.textContent = `Paragraph ${currentReadable || 1} of ${readable.length}`;
}

// ── TTS ──
function speakCurrent() {
  // Skip page breaks
  while (state.currentIndex < state.paragraphs.length &&
         state.paragraphs[state.currentIndex].isPageBreak) {
    state.currentIndex++;
  }

  if (state.currentIndex >= state.paragraphs.length) {
    stopReading();
    return;
  }

  const p = state.paragraphs[state.currentIndex];
  const utterance = new SpeechSynthesisUtterance(p.text);

  if (state.selectedVoice) {
    utterance.voice = state.selectedVoice;
  }
  utterance.rate = state.speed;
  utterance.pitch = state.pitch;

  utterance.onend = () => {
    if (state.isPlaying && !state.isPaused) {
      state.currentIndex++;
      if (state.currentIndex < state.paragraphs.length) {
        highlightParagraph(state.currentIndex);
        scrollToParagraph(state.currentIndex);
        updateProgress();
        speakCurrent();
      } else {
        stopReading();
      }
    }
  };

  utterance.onerror = (e) => {
    // 'interrupted' and 'canceled' are expected when user interacts
    if (e.error !== 'interrupted' && e.error !== 'canceled') {
      console.error('Speech error:', e.error);
    }
  };

  state.utterance = utterance;
  state.isPlaying = true;
  state.isPaused = false;

  highlightParagraph(state.currentIndex);
  scrollToParagraph(state.currentIndex);
  updateProgress();

  speechSynthesis.cancel(); // Clear any pending
  speechSynthesis.speak(utterance);
}

function togglePlayPause() {
  if (state.paragraphs.length === 0) return;

  if (state.isPlaying && !state.isPaused) {
    // Pause
    speechSynthesis.pause();
    state.isPaused = true;
    setPlayingUI(false);
  } else if (state.isPaused) {
    // Resume
    speechSynthesis.resume();
    state.isPaused = false;
    setPlayingUI(true);
  } else {
    // Start fresh
    speakCurrent();
    setPlayingUI(true);
  }
}

function stopReading() {
  speechSynthesis.cancel();
  state.isPlaying = false;
  state.isPaused = false;
  setPlayingUI(false);
}

function prevParagraph() {
  if (state.paragraphs.length === 0) return;

  let newIndex = state.currentIndex - 1;
  // Skip page breaks
  while (newIndex >= 0 && state.paragraphs[newIndex].isPageBreak) {
    newIndex--;
  }
  if (newIndex < 0) newIndex = 0;

  const wasPlaying = state.isPlaying && !state.isPaused;
  speechSynthesis.cancel();
  state.currentIndex = newIndex;
  highlightParagraph(newIndex);
  scrollToParagraph(newIndex);
  updateProgress();

  if (wasPlaying) {
    speakCurrent();
  }
}

function nextParagraph() {
  if (state.paragraphs.length === 0) return;

  let newIndex = state.currentIndex + 1;
  // Skip page breaks
  while (newIndex < state.paragraphs.length && state.paragraphs[newIndex].isPageBreak) {
    newIndex++;
  }
  if (newIndex >= state.paragraphs.length) return;

  const wasPlaying = state.isPlaying && !state.isPaused;
  speechSynthesis.cancel();
  state.currentIndex = newIndex;
  highlightParagraph(newIndex);
  scrollToParagraph(newIndex);
  updateProgress();

  if (wasPlaying) {
    speakCurrent();
  }
}

function setPlayingUI(playing) {
  if (playing) {
    iconPlay.classList.add('hidden');
    iconPause.classList.remove('hidden');
    btnPlay.setAttribute('aria-label', 'Pause');
  } else {
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
    btnPlay.setAttribute('aria-label', 'Play');
  }
}

// ── Settings panel ──
function toggleSettings() {
  settingsPanel.classList.toggle('hidden');
}

// ── Navigation ──
function showScreen(name) {
  landing.classList.remove('active');
  reader.classList.remove('active');
  if (name === 'landing') {
    landing.classList.add('active');
  } else {
    reader.classList.add('active');
  }
}

function goBack() {
  stopReading();
  // Auto-save bookmark when leaving
  if (state.docId && state.paragraphs.length > 0) {
    saveBookmarkData();
  }
  state.paragraphs = [];
  state.currentIndex = 0;
  state.docId = null;
  state.docName = '';
  settingsPanel.classList.add('hidden');
  showScreen('landing');
  showBookmarks();
}

// ── Bookmarks ──
function getBookmarks() {
  try {
    return JSON.parse(localStorage.getItem('pdfr-bookmarks') || '{}');
  } catch {
    return {};
  }
}

function getBookmark(docId) {
  return getBookmarks()[docId] || null;
}

function saveBookmarkData() {
  const bookmarks = getBookmarks();
  const p = state.paragraphs[state.currentIndex];
  bookmarks[state.docId] = {
    name: state.docName,
    index: state.currentIndex,
    pageNum: p ? p.pageNum : 1,
    total: state.paragraphs.filter(x => !x.isPageBreak).length,
    timestamp: Date.now(),
  };
  localStorage.setItem('pdfr-bookmarks', JSON.stringify(bookmarks));
}

function saveBookmark() {
  if (!state.docId || state.paragraphs.length === 0) return;
  saveBookmarkData();

  // Visual feedback
  btnBookmark.style.color = 'var(--accent)';
  setTimeout(() => { btnBookmark.style.color = ''; }, 800);
}

function deleteBookmark(docId) {
  const bookmarks = getBookmarks();
  delete bookmarks[docId];
  localStorage.setItem('pdfr-bookmarks', JSON.stringify(bookmarks));
  showBookmarks();
}

function showBookmarks() {
  const bookmarks = getBookmarks();
  const entries = Object.entries(bookmarks).sort((a, b) => b[1].timestamp - a[1].timestamp);

  if (entries.length === 0) {
    recentBookmarks.classList.add('hidden');
    return;
  }

  recentBookmarks.classList.remove('hidden');
  bookmarkList.innerHTML = '';

  entries.slice(0, 5).forEach(([docId, bm]) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="bookmark-info">
        <span class="bookmark-name">${escapeHtml(bm.name.replace(/\.pdf$/i, ''))}</span>
        <span class="bookmark-detail">Page ${bm.pageNum} &middot; Paragraph ${bm.index + 1} of ${bm.total}</span>
      </div>
      <div class="bookmark-actions">
        <button class="delete-bookmark" aria-label="Delete bookmark" title="Remove">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
    `;

    li.querySelector('.delete-bookmark').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteBookmark(docId);
    });

    bookmarkList.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Start ──
init();
