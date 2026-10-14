export type CaptionFormat = 'text' | 'timestamps' | 'srt';

export const ALL_FORMATS: CaptionFormat[] = ['text', 'timestamps', 'srt'];

export type Settings = {
  format: CaptionFormat;
  enabledFormats: CaptionFormat[];
  showLanguages: boolean;
  shortcutEnabled: boolean;
  shortcut: string;
  cleanText: boolean;
  includeHeader: boolean;
  buttonText: string;
};

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  name: string;
  kind: string;
  vssId: string;
}

export interface TrackData {
  tracks: CaptionTrack[];
  title: string;
  videoId: string;
  activeVssId?: string;
  defaultIndex?: number;
}

export interface ContentResult {
  ok: boolean;
  body: string;
  error?: string;
  errorCode?: 'ad' | 'pot' | 'noCaptions';
  vssId?: string;
}

export const COPY_COMMAND = 'copy-captions';
export const COPY_SHORTCUT = 'Alt+C';

export const MSG = {
  requestTracks: 'YT_CAPTION_REQUEST_TRACKS',
  responseTracks: 'YT_CAPTION_RESPONSE_TRACKS',
  requestContent: 'YT_CAPTION_REQUEST_CONTENT',
  responseContent: 'YT_CAPTION_RESPONSE_CONTENT',
  tracksUpdated: 'YT_CAPTION_TRACKS_UPDATED'
} as const;

export interface PageMessage {
  type: (typeof MSG)[keyof typeof MSG];
  requestId?: string;
  vssId?: string;
  jsonPayload?: string;
}

export type RuntimeMessage =
  | { action: 'trigger-copy-captions' }
  | { action: 'get-caption-menu' }
  | { action: 'get-caption-text'; format?: CaptionFormat; trackIndex?: number };

export interface CaptionMenuInfo {
  tracks: { name: string; kind: string }[];
  selectedTrackIndex: number;
}

export type CaptionTextResult =
  | { ok: true; text: string; trackName: string; wordCount: number }
  | { ok: false; reason: 'noCaptions' | 'ad' | 'noToken' | 'error'; message: string };

export function getDefaultSettings(): Settings {
  return {
    format: 'text',
    enabledFormats: [...ALL_FORMATS],
    showLanguages: false,
    shortcutEnabled: false,
    shortcut: COPY_SHORTCUT,
    cleanText: true,
    includeHeader: false,
    buttonText: 'Captions'
  };
}

export function getEnabledFormats(settings: Settings): CaptionFormat[] {
  const enabled = ALL_FORMATS.filter((f) => settings.enabledFormats?.includes(f));
  return enabled.length > 0 ? enabled : [...ALL_FORMATS];
}

export function getEffectiveFormat(settings: Settings): CaptionFormat {
  const enabled = getEnabledFormats(settings);
  return enabled.includes(settings.format) ? settings.format : enabled[0];
}
