import { MSG, type CaptionTrack, type ContentResult, type PageMessage, type TrackData } from './shared';

interface RawTrack {
  baseUrl?: string;
  languageCode?: string;
  name?: { simpleText?: string; runs?: { text?: string }[] };
  kind?: string;
  vssId?: string;
}

interface CaptionsRenderer {
  captionTracks?: RawTrack[];
  audioTracks?: { defaultCaptionTrackIndex?: number }[];
  defaultAudioTrackIndex?: number;
}

interface PlayerResponse {
  captions?: { playerCaptionsTracklistRenderer?: CaptionsRenderer };
  videoDetails?: { title?: string; videoId?: string };
}

interface YouTubePlayer extends HTMLElement {
  getPlayerResponse?: () => PlayerResponse | null;
  getVideoData?: () => { video_id?: string } | null;
  getOption?: (module: string, option: string) => { vss_id?: string } | null;
}

declare global {
  interface Window {
    __YT_CAPTION_COPIER_PAGE_SCRIPT_INITIALIZED__?: boolean;
    ytInitialPlayerResponse?: PlayerResponse;
    ytplayer?: { config?: { args?: { raw_player_response?: PlayerResponse | string } } };
  }
}

const PLAYER_WAIT_MS = 6000;
const potByVideo = new Map<string, string>();
const playerVssByVideo = new Map<string, string>();
const ownRequests = new Set<string>();

function vssFromUrl(url: URL): string | null {
  const lang = url.searchParams.get('lang');
  if (!lang) return null;
  return (url.searchParams.get('kind') === 'asr' ? 'a.' : '.') + lang;
}

function recordUrl(input: unknown): void {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : '';
    if (!raw || !raw.includes('/api/timedtext')) return;
    const url = new URL(raw, location.origin);
    const v = url.searchParams.get('v');
    if (!v) return;
    const pot = url.searchParams.get('pot');
    if (pot) potByVideo.set(v, pot);
    if (ownRequests.has(url.href)) return;
    const vss = vssFromUrl(url);
    if (vss) playerVssByVideo.set(v, vss);
  } catch {}
}

function installCapture(): void {
  const originalFetch = window.fetch;
  window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    recordUrl(args[0]);
    return originalFetch.apply(this, args);
  } as typeof fetch;

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    recordUrl(args[1]);
    return (originalOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;

  for (const entry of performance.getEntriesByType('resource')) recordUrl(entry.name);
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) recordUrl(entry.name);
    }).observe({ type: 'resource', buffered: true });
  } catch {}
}

function getPlayer(): YouTubePlayer | null {
  return document.getElementById('movie_player') as YouTubePlayer | null;
}

function sanitizeTracks(tracks: RawTrack[] | undefined): CaptionTrack[] {
  if (!Array.isArray(tracks)) return [];
  return tracks.filter(Boolean).map((t) => {
    let name = '';
    if (typeof t.name?.simpleText === 'string') name = t.name.simpleText;
    else if (Array.isArray(t.name?.runs)) name = t.name.runs.map((r) => r.text ?? '').join('');
    return {
      baseUrl: String(t.baseUrl ?? ''),
      languageCode: String(t.languageCode ?? ''),
      name: name || String(t.languageCode ?? '') || 'Captions',
      kind: String(t.kind ?? ''),
      vssId: String(t.vssId ?? '')
    };
  });
}

function getCandidateResponses(): PlayerResponse[] {
  const responses: PlayerResponse[] = [];
  try {
    const pr = getPlayer()?.getPlayerResponse?.();
    if (pr) responses.push(pr);
  } catch {}
  if (window.ytInitialPlayerResponse) responses.push(window.ytInitialPlayerResponse);
  try {
    const raw = window.ytplayer?.config?.args?.raw_player_response;
    if (raw) responses.push(typeof raw === 'string' ? (JSON.parse(raw) as PlayerResponse) : raw);
  } catch {}
  return responses;
}

function getCurrentVideoId(): string {
  try {
    const id = getPlayer()?.getVideoData?.()?.video_id;
    if (id) return id;
  } catch {}
  return new URLSearchParams(location.search).get('v') ?? '';
}

function getActiveVssId(): string {
  try {
    return getPlayer()?.getOption?.('captions', 'track')?.vss_id ?? '';
  } catch {
    return '';
  }
}

function getDefaultIndex(renderer: CaptionsRenderer | undefined): number | undefined {
  const audio = renderer?.audioTracks?.[renderer.defaultAudioTrackIndex ?? 0];
  return typeof audio?.defaultCaptionTrackIndex === 'number' ? audio.defaultCaptionTrackIndex : undefined;
}

function getTrackData(): TrackData {
  const currentId = getCurrentVideoId();
  let title = '';
  let videoId = '';
  let tracks: CaptionTrack[] = [];
  let defaultIndex: number | undefined;

  for (const pr of getCandidateResponses()) {
    const prId = pr.videoDetails?.videoId ?? '';
    if (currentId && prId && prId !== currentId) continue;
    const renderer = pr.captions?.playerCaptionsTracklistRenderer;
    const found = sanitizeTracks(renderer?.captionTracks);
    title ||= pr.videoDetails?.title ?? '';
    videoId ||= prId;
    if (found.length > 0) {
      tracks = found;
      defaultIndex = getDefaultIndex(renderer);
      break;
    }
  }

  return {
    tracks,
    title: title || document.title.replace(/ - YouTube$/, '').trim(),
    videoId: videoId || currentId,
    activeVssId: getActiveVssId(),
    defaultIndex
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface PlayerChoice {
  vss: string | null;
  pot: string | null;
}

function currentChoice(videoId: string): PlayerChoice {
  return {
    vss: getActiveVssId() || playerVssByVideo.get(videoId) || null,
    pot: potByVideo.get(videoId) ?? null
  };
}

async function waitForChoice(videoId: string, timeoutMs: number, needsPot: boolean): Promise<PlayerChoice> {
  const deadline = Date.now() + timeoutMs;
  let choice = currentChoice(videoId);
  while (Date.now() < deadline && (!choice.vss || (needsPot && !choice.pot))) {
    await sleep(100);
    choice = currentChoice(videoId);
  }
  return choice;
}

async function askPlayer(videoId: string, needsPot: boolean): Promise<PlayerChoice> {
  const choice = currentChoice(videoId);
  if (choice.vss && (!needsPot || choice.pot)) return choice;

  const button = document.querySelector<HTMLButtonElement>('#movie_player .ytp-subtitles-button');
  if (!button) return waitForChoice(videoId, 1000, needsPot);

  const wasOn = button.getAttribute('aria-pressed') === 'true';
  button.click();
  if (wasOn) {
    await sleep(150);
    button.click();
  }
  const result = await waitForChoice(videoId, PLAYER_WAIT_MS, needsPot);
  if (!wasOn && button.getAttribute('aria-pressed') === 'true') button.click();
  return result;
}

function matchTrack(tracks: CaptionTrack[], vss: string | null): CaptionTrack | undefined {
  if (!vss) return undefined;
  const exact = tracks.find((t) => t.vssId === vss);
  if (exact) return exact;
  const isAsr = vss.startsWith('a.');
  const lang = vss.replace(/^a?\./, '').split('.')[0];
  return tracks.find((t) => t.languageCode === lang && (t.kind === 'asr') === isAsr) ?? tracks.find((t) => t.languageCode === lang);
}

async function fetchCaptionContent(requestedVss: string | undefined): Promise<ContentResult> {
  try {
    const data = getTrackData();
    if (data.tracks.length === 0) return { ok: false, body: '', errorCode: 'noCaptions', error: 'No captions available for this video.' };

    const videoId = data.videoId || getCurrentVideoId();
    const needsPot = data.tracks.some((t) => t.baseUrl.includes('exp=xpe'));
    const requested = requestedVss ? data.tracks.find((t) => t.vssId === requestedVss) : undefined;
    const choice = requested && (!needsPot || potByVideo.has(videoId)) ? currentChoice(videoId) : await askPlayer(videoId, needsPot);
    const track =
      requested ??
      matchTrack(data.tracks, choice.vss) ??
      (data.defaultIndex !== undefined ? data.tracks[data.defaultIndex] : undefined) ??
      data.tracks[0];
    const pot = needsPot ? choice.pot : null;

    const url = new URL(track.baseUrl, location.origin);

    url.searchParams.set('fmt', 'json3');
    if (pot) {
      url.searchParams.set('c', 'WEB');
      url.searchParams.set('potc', '1');
      url.searchParams.set('pot', pot);
    }

    ownRequests.add(url.href);
    const response = await fetch(url.href, { credentials: 'include' });
    if (!response.ok) return { ok: false, body: '', error: `HTTP ${response.status}` };
    const body = await response.text();
    if (!body.trim() && needsPot && !pot) {
      return getPlayer()?.classList.contains('ad-showing')
        ? { ok: false, body: '', errorCode: 'ad', error: 'Captions are unavailable while an ad is playing.' }
        : { ok: false, body: '', errorCode: 'pot', error: 'YouTube did not provide a caption token. Start playing the video and try again.' };
    }
    return { ok: true, body, vssId: track.vssId };
  } catch (err) {
    return { ok: false, body: '', error: err instanceof Error ? err.message : String(err) };
  }
}

function post(message: PageMessage): void {
  window.postMessage(message, '*');
}

if (!window.__YT_CAPTION_COPIER_PAGE_SCRIPT_INITIALIZED__) {
  window.__YT_CAPTION_COPIER_PAGE_SCRIPT_INITIALIZED__ = true;
  installCapture();

  window.addEventListener('message', (event: MessageEvent<PageMessage>) => {
    if (event.source !== window || !event.data) return;
    const { type, requestId, vssId } = event.data;

    if (type === MSG.requestTracks) {
      post({ type: MSG.responseTracks, requestId, jsonPayload: JSON.stringify(getTrackData()) });
    } else if (type === MSG.requestContent) {
      void fetchCaptionContent(vssId).then((result) => {
        post({ type: MSG.responseContent, requestId, jsonPayload: JSON.stringify(result) });
      });
    }
  });

  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(() => {
      post({ type: MSG.tracksUpdated, jsonPayload: JSON.stringify(getTrackData()) });
    }, 350);
  });
}
