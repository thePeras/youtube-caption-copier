import type { CaptionFormat } from './shared';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON_PATHS = {
  cc: 'M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H5V6h14v12zM7 15h3c.55 0 1-.45 1-1v-1H9.5v.5h-2v-3h2v.5H11v-1c0-.55-.45-1-1-1H7c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1zm7 0h3c.55 0 1-.45 1-1v-1h-1.5v.5h-2v-3h2v.5H18v-1c0-.55-.45-1-1-1h-3c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  chevron: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
  spinner: 'M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z',
  warning: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z'
};

export type IconName = keyof typeof ICON_PATHS;

export function createIcon(name: IconName, size = 24, className?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  if (className) svg.setAttribute('class', className);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.appendChild(path);
  return svg;
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.append(...children);
  return el;
}

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

    this.iconEl = createElement('span', 'yt-caption-copier-icon', createIcon('cc'));
    this.labelEl = createElement('span', 'yt-caption-copier-label', this.label);

    const mainBtn = createElement('button', 'yt-caption-copier-main-btn', this.iconEl, this.labelEl);
    mainBtn.title = 'Copy captions to clipboard';
    mainBtn.setAttribute('aria-label', 'Copy captions');

    const chevronBtn = createElement('button', 'yt-caption-copier-chevron-btn', createIcon('chevron', 16));
    chevronBtn.title = 'Caption options and formats';
    chevronBtn.setAttribute('aria-label', 'Caption options');

    this.pill = createElement('div', 'yt-caption-copier-pill', mainBtn, createElement('div', 'yt-caption-copier-divider'), chevronBtn);

    const wrapper = createElement('div', ['yt-caption-copier-wrapper', options.extraClass].filter(Boolean).join(' '), this.pill);
    if (options.id) wrapper.id = options.id;
    this.element = wrapper;

    this.menu = document.createElement('div');
    this.menu.className = 'yt-caption-copier-menu';
    this.menu.setAttribute('role', 'menu');
    document.body.appendChild(this.menu);

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
    chevronBtn.addEventListener('click', (e) => {
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
    this.iconEl.replaceChildren(createIcon('spinner'));
    this.iconEl.classList.add('spinning');
    this.labelEl.textContent = STRINGS.loading;
  }

  setCopied(): void {
    this.busy = false;
    this.pill.classList.add('copied');
    this.iconEl.classList.remove('spinning');
    this.iconEl.replaceChildren(createIcon('check'));
    this.labelEl.textContent = STRINGS.copied;
    this.scheduleReset();
  }

  setMessage(message: string): void {
    this.busy = false;
    this.pill.classList.remove('copied');
    this.iconEl.classList.remove('spinning');
    this.iconEl.replaceChildren(createIcon('cc'));
    this.labelEl.textContent = message;
    this.scheduleReset();
  }

  reset(): void {
    this.busy = false;
    this.clearLabelTimer();
    this.pill.classList.remove('copied');
    this.iconEl.classList.remove('spinning');
    this.iconEl.replaceChildren(createIcon('cc'));
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
    const sections: HTMLElement[][] = [];
    const item = (active: boolean, content: Node, onSelect: () => void) => {
      const li = createElement(
        'li',
        ['yt-caption-copier-menu-item', active ? 'active' : ''].filter(Boolean).join(' '),
        content,
        createElement('div', 'yt-caption-copier-menu-item-check', createIcon('check', 18))
      );
      li.setAttribute('role', 'menuitem');
      li.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.closeMenu();
        onSelect();
      });
      return li;
    };
    const section = (title: string, items: HTMLElement[]) => [
      createElement('div', 'yt-caption-copier-menu-section-title', title),
      createElement('ul', 'yt-caption-copier-menu-list', ...items)
    ];

    if (model.formats.length > 1) {
      sections.push(
        section(
          STRINGS.formatTitle,
          model.formats.map((fmt) =>
            item(fmt === model.currentFormat, createElement('span', undefined, FORMAT_LABELS[fmt]), () => this.options.onSelectFormat(fmt))
          )
        )
      );
    }

    if (model.showLanguages && model.tracks.length > 1) {
      sections.push(
        section(
          STRINGS.langTitle,
          model.tracks.map((track, idx) => {
            const label = createElement('div', 'yt-caption-copier-menu-item-label', createElement('span', undefined, track.name));
            if (track.kind === 'asr') label.append(createElement('span', 'yt-caption-copier-menu-badge', STRINGS.autoBadge));
            return item(idx === model.selectedTrackIndex, label, () => this.options.onSelectTrack(idx));
          })
        )
      );
    }

    this.menu.replaceChildren(
      ...sections.flatMap((nodes, i) => (i === 0 ? nodes : [createElement('div', 'yt-caption-copier-menu-divider'), ...nodes]))
    );
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
