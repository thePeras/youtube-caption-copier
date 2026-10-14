import type { CaptionFormat } from './shared';

export const ICONS = {
  cc: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
    <path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H5V6h14v12zM7 15h3c.55 0 1-.45 1-1v-1H9.5v.5h-2v-3h2v.5H11v-1c0-.55-.45-1-1-1H7c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1zm7 0h3c.55 0 1-.45 1-1v-1h-1.5v.5h-2v-3h2v.5H18v-1c0-.55-.45-1-1-1h-3c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1z"/>
  </svg>`,
  check: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
  </svg>`,
  chevron: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
  </svg>`,
  spinner: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
    <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/>
  </svg>`,
  itemCheck: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
  </svg>`
};

export const STRINGS = {
  copied: 'Copied!',
  noCaptions: 'No Captions',
  noCaptionsToast: 'No captions available for this video.',
  copiedToast: 'Captions copied to clipboard!',
  loading: 'Loading...',
  words: 'words',
  autoBadge: 'Auto',
  formatTitle: 'Format',
  langTitle: 'Languages',
  plainText: 'Plain Text (Paragraphs)',
  withTimestamps: 'With Timestamps [00:00]',
  srtFormat: 'SRT (.srt)',
  adPlaying: 'Wait for the ad to finish and try again.',
  noToken: 'YouTube did not provide a caption token. Play the video and try again.',
  errorPrefix: 'Error copying captions: ',
  error: 'Error'
};

export const FORMAT_LABELS: Record<CaptionFormat, string> = {
  text: STRINGS.plainText,
  timestamps: STRINGS.withTimestamps,
  srt: STRINGS.srtFormat
};

export interface MenuTrack {
  name: string;
  kind: string;
}

export interface MenuModel {
  formats: CaptionFormat[];
  currentFormat: CaptionFormat;
  showLanguages: boolean;
  tracks: MenuTrack[];
  selectedTrackIndex: number;
}

export interface CaptionButtonOptions {
  label: string;
  id?: string;
  extraClass?: string;
  onCopy: () => void;
  getMenuModel: () => Promise<MenuModel>;
  onSelectFormat: (format: CaptionFormat) => void;
  onSelectTrack: (index: number) => void;
}

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;
const LABEL_RESET_MS = 2500;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function hasMenuOptions(model: Pick<MenuModel, 'formats' | 'showLanguages' | 'tracks'>): boolean {
  return model.formats.length > 1 || (model.showLanguages && model.tracks.length > 1);
}

export class CaptionButton {
  readonly element: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly iconEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly menu: HTMLElement;
  private label: string;
  private busy = false;
  private labelTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: CaptionButtonOptions) {
    this.label = options.label;

    const wrapper = document.createElement('div');
    if (options.id) wrapper.id = options.id;
    wrapper.className = ['yt-caption-copier-wrapper', options.extraClass].filter(Boolean).join(' ');
    wrapper.innerHTML = `
      <div class="yt-caption-copier-pill">
        <button class="yt-caption-copier-main-btn" title="Copy captions to clipboard" aria-label="Copy captions">
          <span class="yt-caption-copier-icon">${ICONS.cc}</span>
          <span class="yt-caption-copier-label">${escapeHtml(this.label)}</span>
        </button>
        <div class="yt-caption-copier-divider"></div>
        <button class="yt-caption-copier-chevron-btn" title="Caption options and formats" aria-label="Caption options">
          ${ICONS.chevron}
        </button>
      </div>
    `;

    this.element = wrapper;
    this.pill = wrapper.querySelector('.yt-caption-copier-pill')!;
    this.iconEl = wrapper.querySelector('.yt-caption-copier-icon')!;
    this.labelEl = wrapper.querySelector('.yt-caption-copier-label')!;

    this.menu = document.createElement('div');
    this.menu.className = 'yt-caption-copier-menu';
    this.menu.setAttribute('role', 'menu');
    document.body.appendChild(this.menu);

    const mainBtn = wrapper.querySelector<HTMLButtonElement>('.yt-caption-copier-main-btn')!;
    mainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeMenu();
      options.onCopy();
    });
    mainBtn.addEventListener('contextmenu', (e) => {
      if (this.element.classList.contains('single')) return;
      e.preventDefault();
      void this.toggleMenu(e);
    });
    wrapper.querySelector<HTMLButtonElement>('.yt-caption-copier-chevron-btn')!.addEventListener('click', (e) => {
      void this.toggleMenu(e);
    });

    document.addEventListener('click', this.onDocumentClick);
    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('scroll', this.onReposition, { capture: true, passive: true });
    window.addEventListener('resize', this.onReposition);
  }

  get isBusy(): boolean {
    return this.busy;
  }

  setLabel(label: string): void {
    this.label = label;
    if (!this.busy && this.labelTimer === undefined) this.labelEl.textContent = label;
  }

  setHasOptions(hasOptions: boolean): void {
    this.element.classList.toggle('single', !hasOptions);
    if (!hasOptions) this.closeMenu();
  }

  setDisabled(disabled: boolean, reason = ''): void {
    this.element.classList.toggle('disabled', disabled);
    this.element.title = disabled ? reason : '';
    this.element.querySelectorAll('button').forEach((b) => {
      b.disabled = disabled;
    });
    if (disabled) this.closeMenu();
  }

  setLoading(): void {
    this.busy = true;
    this.clearLabelTimer();
    this.pill.classList.remove('copied');
    this.iconEl.innerHTML = ICONS.spinner;
    this.iconEl.classList.add('spinning');
    this.labelEl.textContent = STRINGS.loading;
  }

  setCopied(): void {
    this.busy = false;
    this.pill.classList.add('copied');
    this.iconEl.classList.remove('spinning');
    this.iconEl.innerHTML = ICONS.check;
    this.labelEl.textContent = STRINGS.copied;
    this.scheduleReset();
  }

  setMessage(message: string): void {
    this.busy = false;
    this.pill.classList.remove('copied');
    this.iconEl.classList.remove('spinning');
    this.iconEl.innerHTML = ICONS.cc;
    this.labelEl.textContent = message;
    this.scheduleReset();
  }

  reset(): void {
    this.busy = false;
    this.clearLabelTimer();
    this.pill.classList.remove('copied');
    this.iconEl.classList.remove('spinning');
    this.iconEl.innerHTML = ICONS.cc;
    this.labelEl.textContent = this.label;
  }

  closeMenu(): void {
    this.menu.classList.remove('open');
  }

  destroy(): void {
    this.clearLabelTimer();
    document.removeEventListener('click', this.onDocumentClick);
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('scroll', this.onReposition, { capture: true });
    window.removeEventListener('resize', this.onReposition);
    this.menu.remove();
    this.element.remove();
  }

  private scheduleReset(): void {
    this.clearLabelTimer();
    this.labelTimer = setTimeout(() => {
      this.labelTimer = undefined;
      this.reset();
    }, LABEL_RESET_MS);
  }

  private clearLabelTimer(): void {
    if (this.labelTimer !== undefined) clearTimeout(this.labelTimer);
    this.labelTimer = undefined;
  }

  private isMenuOpen(): boolean {
    return this.menu.classList.contains('open');
  }

  private async toggleMenu(e: Event): Promise<void> {
    e.stopPropagation();
    if (this.isMenuOpen()) {
      this.closeMenu();
      return;
    }

    const model = await this.options.getMenuModel();
    this.setHasOptions(hasMenuOptions(model));
    if (!hasMenuOptions(model)) return;

    this.renderMenu(model);
    this.positionMenu();
    this.menu.classList.add('open');
  }

  private renderMenu(model: MenuModel): void {
    const sections: string[] = [];
    const item = (attrs: string, active: boolean, content: string) => `
      <li class="yt-caption-copier-menu-item ${active ? 'active' : ''}" role="menuitem" ${attrs}>
        ${content}
        <div class="yt-caption-copier-menu-item-check">${ICONS.itemCheck}</div>
      </li>`;

    if (model.formats.length > 1) {
      sections.push(`
        <div class="yt-caption-copier-menu-section-title">${STRINGS.formatTitle}</div>
        <ul class="yt-caption-copier-menu-list">
          ${model.formats
            .map((fmt) => item(`data-format="${fmt}"`, fmt === model.currentFormat, `<span>${FORMAT_LABELS[fmt]}</span>`))
            .join('')}
        </ul>`);
    }

    if (model.showLanguages && model.tracks.length > 1) {
      sections.push(`
        <div class="yt-caption-copier-menu-section-title">${STRINGS.langTitle}</div>
        <ul class="yt-caption-copier-menu-list">
          ${model.tracks
            .map((track, idx) =>
              item(
                `data-track-index="${idx}"`,
                idx === model.selectedTrackIndex,
                `<div class="yt-caption-copier-menu-item-label">
                  <span>${escapeHtml(track.name)}</span>
                  ${track.kind === 'asr' ? `<span class="yt-caption-copier-menu-badge">${STRINGS.autoBadge}</span>` : ''}
                </div>`
              )
            )
            .join('')}
        </ul>`);
    }

    this.menu.innerHTML = sections.join('<div class="yt-caption-copier-menu-divider"></div>');

    this.menu.querySelectorAll<HTMLElement>('[data-format]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.closeMenu();
        this.options.onSelectFormat(el.dataset.format as CaptionFormat);
      });
    });

    this.menu.querySelectorAll<HTMLElement>('[data-track-index]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.closeMenu();
        this.options.onSelectTrack(parseInt(el.dataset.trackIndex ?? '0', 10));
      });
    });
  }

  private positionMenu(): void {
    const rect = this.pill.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = this.menu;
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft));
    const fitsBelow = rect.bottom + MENU_GAP + height <= window.innerHeight - VIEWPORT_MARGIN;
    const top = fitsBelow ? rect.bottom + MENU_GAP : Math.max(VIEWPORT_MARGIN, rect.top - MENU_GAP - height);

    this.menu.classList.toggle('above', !fitsBelow);
    this.menu.style.left = `${Math.round(left)}px`;
    this.menu.style.top = `${Math.round(top)}px`;
  }

  private readonly onDocumentClick = (e: MouseEvent): void => {
    const target = e.target as Node | null;
    if (this.isMenuOpen() && target && !this.menu.contains(target) && !this.element.contains(target)) {
      this.closeMenu();
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.closeMenu();
  };

  private readonly onReposition = (): void => {
    if (this.isMenuOpen()) this.positionMenu();
  };
}
