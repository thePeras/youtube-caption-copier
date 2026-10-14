import { CaptionButton, STRINGS, createElement, createIcon, hasMenuOptions, type MenuModel } from './caption-button';
import {
  MSG,
  getDefaultSettings,
  getEffectiveFormat,
  getEnabledFormats,
  type CaptionFormat,
  type CaptionMenuInfo,
  type CaptionTextResult,
  type CaptionTrack,
  type ContentResult,
  type PageMessage,
  type RuntimeMessage,
  type Settings,
  type TrackData
} from './shared';

interface CaptionItem {
  start: number;
  dur: number;
  end: number;
  text: string;
}

interface Json3Captions {
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
}

type ToastType = 'warning' | null;

const TRACKS_TIMEOUT_MS = 1500;
const CONTENT_TIMEOUT_MS = 15000;

let currentVideoId: string | null = null;
let cachedTracks: CaptionTrack[] | null = null;
let cachedTitle = '';
let selectedTrackIndex = 0;
let userPickedTrack = false;
let button: CaptionButton | null = null;
let toastTimeout: ReturnType<typeof setTimeout> | null = null;
let settings: Settings = getDefaultSettings();
const pendingCallbacks = new Map<string, (payload: string | null) => void>();

async function loadSettings(): Promise<void> {
  try {
    const stored = (await browser.storage.local.get(null)) as Partial<Settings>;
    settings = { ...settings, ...stored };
    updateButtonUI();
  } catch {}
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const key of Object.keys(changes)) {
    Object.assign(settings, { [key]: changes[key].newValue });
  }
  updateButtonUI();
});

function injectPageScript(): void {
  if (document.getElementById('yt-caption-copier-script-tag')) return;
  try {
    const script = document.createElement('script');
    script.id = 'yt-caption-copier-script-tag';
    script.src = browser.runtime.getURL('page-script.js');
    (document.head || document.documentElement).appendChild(script);
  } catch (err) {
    console.warn('[YT Caption Copier] Could not inject page script:', err);
  }
}

window.addEventListener('message', (event: MessageEvent<PageMessage>) => {
  if (event.source !== window || !event.data) return;
  const { type, requestId, jsonPayload } = event.data;

  if ((type === MSG.responseTracks || type === MSG.responseContent) && requestId) {
    const cb = pendingCallbacks.get(requestId);
    if (cb) {
      pendingCallbacks.delete(requestId);
      cb(typeof jsonPayload === 'string' ? jsonPayload : null);
    }
  } else if (type === MSG.tracksUpdated && typeof jsonPayload === 'string') {
    try {
      const data = JSON.parse(jsonPayload) as TrackData;
      if (data.videoId === getVideoId()) {
        currentVideoId = data.videoId;
        setTrackData(data);
      }
    } catch {}
  }
});

function requestFromPage<T>(message: PageMessage, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const requestId = 'req_' + Math.random().toString(36).slice(2, 11);
    const timer = setTimeout(() => {
      pendingCallbacks.delete(requestId);
      resolve(null);
    }, timeoutMs);

    pendingCallbacks.set(requestId, (payload) => {
      clearTimeout(timer);
      try {
        resolve(payload ? (JSON.parse(payload) as T) : null);
      } catch {
        resolve(null);
      }
    });

    window.postMessage({ ...message, requestId }, '*');
  });
}

function getVideoId(): string | null {
  const v = new URLSearchParams(window.location.search).get('v');
  if (v) return v;
  if (window.location.pathname.startsWith('/shorts/')) {
    const id = window.location.pathname.split('/shorts/')[1];
    if (id) return id.split(/[?#/]/)[0];
  }
  return null;
}

function setTrackData(data: TrackData): void {
  if (!Array.isArray(data.tracks)) return;
  cachedTracks = data.tracks;
  cachedTitle = data.title || cachedTitle;
  if (!userPickedTrack) pickDefaultTrack(data);
  updateChevronVisibility();
}

function pickDefaultTrack(data: TrackData): void {
  const tracks = data.tracks;
  if (tracks.length === 0) return;

  const activeIdx = data.activeVssId ? tracks.findIndex((t) => t.vssId === data.activeVssId) : -1;
  if (activeIdx !== -1) {
    selectedTrackIndex = activeIdx;
    return;
  }

  if (data.defaultIndex !== undefined && tracks[data.defaultIndex]) {
    selectedTrackIndex = data.defaultIndex;
    return;
  }

  const browserLang = (navigator.language || 'en').toLowerCase().split('-')[0];
  const langIdx = tracks.findIndex((t) => t.languageCode.toLowerCase().startsWith(browserLang) && t.kind !== 'asr');
  if (langIdx !== -1) {
    selectedTrackIndex = langIdx;
    return;
  }

  const firstManual = tracks.findIndex((t) => t.kind !== 'asr');
  selectedTrackIndex = firstManual !== -1 ? firstManual : 0;
}

async function getCaptionTracks(): Promise<CaptionTrack[] | null> {
  const vId = getVideoId();
  if (!vId) return null;

  if (currentVideoId !== vId) userPickedTrack = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await requestFromPage<TrackData>({ type: MSG.requestTracks }, TRACKS_TIMEOUT_MS);
    if (data && data.tracks.length > 0 && (!data.videoId || data.videoId === vId)) {
      currentVideoId = vId;
      setTrackData(data);
      return cachedTracks;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (cachedTracks && cachedTracks.length > 0 && currentVideoId === vId) return cachedTracks;
  return null;
}

function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function normalizeText(text: string): string {
  return decodeHtmlEntities(text).replace(/\s+/g, ' ').trim();
}

function parseXmlCaptions(xmlString: string): CaptionItem[] {
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');
  const items: CaptionItem[] = [];

  const textNodes = doc.querySelectorAll('text');
  if (textNodes.length > 0) {
    textNodes.forEach((node) => {
      const start = parseFloat(node.getAttribute('start') || '0');
      const dur = parseFloat(node.getAttribute('dur') || '0');
      const text = normalizeText(node.textContent || '');
      if (text) items.push({ start, dur, end: start + dur, text });
    });
    return items;
  }

  doc.querySelectorAll('p').forEach((node) => {
    const start = parseFloat(node.getAttribute('t') || '0') / 1000;
    const dur = parseFloat(node.getAttribute('d') || '0') / 1000;
    const text = normalizeText(node.textContent || '');
    if (text) items.push({ start, dur, end: start + dur, text });
  });
  return items;
}

function parseJsonCaptions(json: Json3Captions): CaptionItem[] {
  const items: CaptionItem[] = [];
  for (const event of json.events ?? []) {
    if (!event.segs) continue;
    const start = (event.tStartMs || 0) / 1000;
    const dur = (event.dDurationMs || 0) / 1000;
    const text = normalizeText(event.segs.map((s) => s.utf8 || '').join(''));
    if (text) items.push({ start, dur, end: start + dur, text });
  }
  return items;
}

function parseCaptions(body: string): CaptionItem[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{')) {
    try {
      return parseJsonCaptions(JSON.parse(trimmed) as Json3Captions);
    } catch {
      return [];
    }
  }
  return parseXmlCaptions(trimmed);
}

function cleanRepeatedWords(items: CaptionItem[]): CaptionItem[] {
  return items
    .map((item, idx) => {
      if (idx === 0) return item;
      const prevWords = items[idx - 1].text.toLowerCase().split(/\s+/);
      const currWords = item.text.split(/\s+/);
      if (currWords[0]?.toLowerCase() === prevWords[prevWords.length - 1]) {
        currWords.shift();
        return { ...item, text: currWords.join(' ') };
      }
      return item;
    })
    .filter((i) => i.text.length > 0);
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

function formatSeconds(total: number): string {
  const sec = Math.floor(total);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatSrtTime(total: number): string {
  const ms = Math.floor((total % 1) * 1000);
  const sec = Math.floor(total);
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)},${pad(ms, 3)}`;
}

function formatAsCleanText(items: CaptionItem[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];

  items.forEach((item, i) => {
    const prev = i > 0 ? items[i - 1] : null;
    const isLongPause = prev !== null && item.start - prev.end > 3.5;
    const isSentenceEnd = /[.?!]$/.test(current[current.length - 1] ?? '');
    if ((isLongPause || current.length >= 12) && isSentenceEnd) {
      paragraphs.push(current.join(' '));
      current = [];
    }
    current.push(item.text);
  });

  if (current.length > 0) paragraphs.push(current.join(' '));
  return paragraphs.join('\n\n');
}

function formatWithTimestamps(items: CaptionItem[]): string {
  return items.map((item) => `[${formatSeconds(item.start)}] ${item.text}`).join('\n');
}

function formatAsSrt(items: CaptionItem[]): string {
  return items
    .map((item, idx) => `${idx + 1}\n${formatSrtTime(item.start)} --> ${formatSrtTime(item.end)}\n${item.text}\n`)
    .join('\n');
}

function getTrackName(track: CaptionTrack | undefined): string {
  if (!track) return 'Captions';
  let name = track.name || track.languageCode.toUpperCase() || 'UNKNOWN';
  if (track.kind === 'asr' && !/auto|autom/i.test(name)) name += ' (auto-generated)';
  return name;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    Object.assign(textarea.style, { position: 'fixed', left: '-9999px', top: '-9999px' });
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    textarea.remove();
    return success;
  } catch {
    return false;
  }
}

function formatItems(items: CaptionItem[], fmt: CaptionFormat): string {
  if (fmt === 'timestamps') return formatWithTimestamps(items);
  if (fmt === 'srt') return formatAsSrt(items);
  return formatAsCleanText(items);
}

async function buildCaptionText(formatOverride: CaptionFormat | null = null, trackOverrideIndex: number | null = null): Promise<CaptionTextResult> {
  try {
    const tracks = await getCaptionTracks();
    if (!tracks || tracks.length === 0) return { ok: false, reason: 'noCaptions', message: STRINGS.noCaptionsToast };

    if (trackOverrideIndex !== null && tracks[trackOverrideIndex]) {
      selectedTrackIndex = trackOverrideIndex;
      userPickedTrack = true;
    }
    const requestedVss = userPickedTrack ? tracks[selectedTrackIndex]?.vssId : undefined;

    const result = await requestFromPage<ContentResult>({ type: MSG.requestContent, vssId: requestedVss }, CONTENT_TIMEOUT_MS);
    if (!result) return { ok: false, reason: 'error', message: STRINGS.errorPrefix + 'Timed out fetching captions' };
    if (!result.ok) {
      if (result.errorCode === 'ad') return { ok: false, reason: 'ad', message: STRINGS.adPlaying };
      if (result.errorCode === 'pot') return { ok: false, reason: 'noToken', message: STRINGS.noToken };
      if (result.errorCode === 'noCaptions') return { ok: false, reason: 'noCaptions', message: STRINGS.noCaptionsToast };
      return { ok: false, reason: 'error', message: STRINGS.errorPrefix + (result.error || 'Failed to fetch captions') };
    }

    const usedIndex = tracks.findIndex((t) => t.vssId === result.vssId);
    if (usedIndex !== -1) selectedTrackIndex = usedIndex;
    const track = tracks[selectedTrackIndex] ?? tracks[0];

    let items = parseCaptions(result.body);
    if (items.length === 0) return { ok: false, reason: 'noCaptions', message: STRINGS.noCaptionsToast };
    if (settings.cleanText) items = cleanRepeatedWords(items);

    let text = formatItems(items, formatOverride || getEffectiveFormat(settings));
    if (settings.includeHeader) {
      const title = cachedTitle || document.title.replace(/ - YouTube$/, '').trim();
      text = [`Title: ${title}`, `URL: ${window.location.href}`, `Captions: ${getTrackName(track)}`, '-'.repeat(40), '', ''].join('\n') + text;
    }

    return { ok: true, text, trackName: getTrackName(track), wordCount: text.trim().split(/\s+/).length };
  } catch (err) {
    console.error('[YT Caption Copier] Error building captions:', err);
    return { ok: false, reason: 'error', message: STRINGS.errorPrefix + (err instanceof Error ? err.message : String(err)) };
  }
}

async function handleCopyCaptions(formatOverride: CaptionFormat | null = null, trackOverrideIndex: number | null = null): Promise<void> {
  if (button?.isBusy) return;
  button?.setLoading();

  const result = await buildCaptionText(formatOverride, trackOverrideIndex);
  if (!result.ok) {
    showToast(result.message, 'warning');
    button?.setMessage(result.reason === 'error' ? STRINGS.error : STRINGS.noCaptions);
    return;
  }

  if (!(await copyToClipboard(result.text))) {
    showToast(STRINGS.errorPrefix + 'Failed to write to clipboard', 'warning');
    button?.setMessage(STRINGS.error);
    return;
  }

  button?.setCopied();
  showToast(STRINGS.copiedToast, null, `${result.trackName} • ${result.wordCount.toLocaleString()} ${STRINGS.words}`);
}

function showToast(message: string, type: ToastType = null, meta: string | null = null): void {
  let toast = document.getElementById('yt-caption-copier-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'yt-caption-copier-toast';
    toast.className = 'yt-caption-copier-toast';
    document.body.appendChild(toast);
  }

  const messageEl = createElement('div', 'yt-caption-copier-toast-message', createElement('div', undefined, message));
  if (meta) messageEl.append(createElement('div', 'yt-caption-copier-toast-meta', meta));
  toast.replaceChildren(
    createIcon(type === 'warning' ? 'warning' : 'check', 24, type === 'warning' ? 'yt-caption-copier-toast-icon warning' : 'yt-caption-copier-toast-icon'),
    messageEl
  );
  toast.classList.add('visible');

  if (toastTimeout) clearTimeout(toastTimeout);
  const el = toast;
  toastTimeout = setTimeout(() => el.classList.remove('visible'), 3800);
}

function getMenuInfo(): CaptionMenuInfo {
  const tracks = currentVideoId === getVideoId() ? cachedTracks ?? [] : [];
  return {
    tracks: tracks.map((t) => ({ name: getTrackName(t), kind: t.kind })),
    selectedTrackIndex
  };
}

function getMenuModel(): MenuModel {
  return {
    formats: getEnabledFormats(settings),
    currentFormat: getEffectiveFormat(settings),
    showLanguages: settings.showLanguages,
    ...getMenuInfo()
  };
}

function selectFormat(format: CaptionFormat): void {
  settings.format = format;
  void browser.storage.local.set({ format });
}

function updateChevronVisibility(): void {
  button?.setHasOptions(hasMenuOptions(getMenuModel()));
}

const CONTAINER_SELECTORS = [
  'ytd-watch-metadata #actions-inner #menu ytd-menu-renderer #top-level-buttons-computed',
  'ytd-watch-metadata #top-level-buttons-computed',
  'ytd-watch-metadata yt-flexible-actions-view-model',
  '#actions-inner #top-level-buttons-computed',
  '#actions #top-level-buttons-computed',
  '#top-level-buttons-computed'
];

function findButtonsContainer(): HTMLElement | null {
  for (const selector of CONTAINER_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

function createButton(): CaptionButton {
  const created = new CaptionButton({
    id: 'yt-caption-copier-btn-wrapper',
    extraClass: 'ytd-menu-renderer',
    label: settings.buttonText || 'Captions',
    onCopy: () => void handleCopyCaptions(),
    getMenuModel: async () => {
      await getCaptionTracks();
      return getMenuModel();
    },
    onSelectFormat: (format) => {
      selectFormat(format);
      void handleCopyCaptions(format);
    },
    onSelectTrack: (index) => void handleCopyCaptions(null, index)
  });
  created.setHasOptions(hasMenuOptions(getMenuModel()));
  return created;
}

function ensureButtonInjected(): void {
  if (!window.location.pathname.startsWith('/watch')) return;

  const container = findButtonsContainer();
  if (!container) return;

  if (button?.element.parentElement === container) return;
  button?.destroy();
  document.getElementById('yt-caption-copier-btn-wrapper')?.remove();

  button = createButton();
  const newBtn = button.element;
  const overflowButton = container.querySelector(
    'ytd-menu-renderer > yt-icon-button, button[aria-label="More actions"], yt-button-shape.ytd-menu-renderer:last-child'
  );
  if (overflowButton?.parentElement === container) {
    container.insertBefore(newBtn, overflowButton);
  } else {
    container.appendChild(newBtn);
  }

  const newVid = getVideoId();
  if (newVid !== currentVideoId) {
    currentVideoId = null;
    cachedTracks = null;
    void getCaptionTracks().then(updateChevronVisibility);
  }
}

function updateButtonUI(): void {
  button?.setLabel(settings.buttonText || 'Captions');
  updateChevronVisibility();
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
new MutationObserver(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(ensureButtonInjected, 60);
}).observe(document.body, { childList: true, subtree: true });

window.addEventListener('yt-navigate-finish', () => setTimeout(ensureButtonInjected, 150));
window.addEventListener('yt-page-data-updated', () => setTimeout(ensureButtonInjected, 150));

browser.runtime.onMessage.addListener((raw: unknown) => {
  const message = raw as RuntimeMessage | undefined;
  switch (message?.action) {
    case 'trigger-copy-captions':
      void handleCopyCaptions();
      return undefined;
    case 'get-caption-menu':
      return getCaptionTracks().then(getMenuInfo);
    case 'get-caption-text':
      if (message.format) selectFormat(message.format);
      return buildCaptionText(message.format ?? null, message.trackIndex ?? null);
    default:
      return undefined;
  }
});

injectPageScript();
void loadSettings();
ensureButtonInjected();
