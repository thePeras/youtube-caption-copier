import { CaptionButton, STRINGS, hasMenuOptions, type MenuModel } from './caption-button';
import { eventToShortcut, shortcutKeys } from './shortcut';
import {
  ALL_FORMATS,
  COPY_COMMAND,
  getDefaultSettings,
  getEnabledFormats,
  type CaptionFormat,
  type CaptionMenuInfo,
  type CaptionTextResult,
  type RuntimeMessage,
  type Settings
} from './shared';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): (...args: A) => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.toggleAttribute('dark', darkQuery.matches);
applyTheme();
darkQuery.addEventListener('change', applyTheme);

document.addEventListener('DOMContentLoaded', async () => {
  const buttonHost = byId<HTMLDivElement>('captionButtonHost');
  const buttonTextInput = byId<HTMLInputElement>('buttonTextInput');
  const cleanTextToggle = byId<HTMLInputElement>('cleanTextToggle');
  const includeHeaderToggle = byId<HTMLInputElement>('includeHeaderToggle');
  const showLanguagesToggle = byId<HTMLInputElement>('showLanguagesToggle');
  const shortcutToggle = byId<HTMLInputElement>('shortcutToggle');
  const shortcutRecorder = byId<HTMLDivElement>('shortcutRecorder');
  const shortcutDisplay = byId<HTMLButtonElement>('shortcutDisplay');
  const shortcutHint = byId<HTMLSpanElement>('shortcutHint');
  const formatChecks = [...byId<HTMLDivElement>('enabledFormats').querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

  let lastFormat: CaptionFormat = getDefaultSettings().format;
  let shortcut = getDefaultSettings().shortcut;
  const canUpdateShortcut = typeof browser.commands.update === 'function';
  const idleHint = canUpdateShortcut ? 'Click to record a new shortcut' : 'Click to change it in the browser shortcut settings';
  let recording = false;
  let activeTabId: number | null = null;
  let menuInfo: CaptionMenuInfo = { tracks: [], selectedTrackIndex: 0 };

  function readEnabledFormats(): CaptionFormat[] {
    return ALL_FORMATS.filter((fmt) => formatChecks.some((c) => c.value === fmt && c.checked));
  }

  function getButtonLabel(): string {
    return buttonTextInput.value.trim() || 'Captions';
  }

  function getMenuModel(): MenuModel {
    const formats = readEnabledFormats();
    return {
      formats,
      currentFormat: formats.includes(lastFormat) ? lastFormat : formats[0],
      showLanguages: showLanguagesToggle.checked,
      ...menuInfo
    };
  }

  async function refreshMenuInfo(): Promise<void> {
    if (activeTabId === null) return;
    try {
      const message: RuntimeMessage = { action: 'get-caption-menu' };
      const info = (await browser.tabs.sendMessage(activeTabId, message)) as CaptionMenuInfo | undefined;
      if (info) menuInfo = info;
    } catch {}
  }

  async function copyFromTab(format?: CaptionFormat, trackIndex?: number): Promise<void> {
    if (activeTabId === null || button.isBusy) return;
    button.setLoading();

    try {
      const message: RuntimeMessage = { action: 'get-caption-text', format, trackIndex };
      const result = (await browser.tabs.sendMessage(activeTabId, message)) as CaptionTextResult | undefined;
      if (!result) throw new Error('No response from the YouTube tab');

      if (!result.ok) {
        button.setMessage(result.reason === 'error' ? STRINGS.error : STRINGS.noCaptions);
        return;
      }

      await navigator.clipboard.writeText(result.text);
      if (trackIndex !== undefined) menuInfo = { ...menuInfo, selectedTrackIndex: trackIndex };
      button.setCopied();
    } catch {
      button.setMessage(STRINGS.error);
    }
  }

  const button = new CaptionButton({
    label: 'Captions',
    onCopy: () => void copyFromTab(),
    getMenuModel: async () => {
      await refreshMenuInfo();
      return getMenuModel();
    },
    onSelectFormat: (format) => {
      lastFormat = format;
      void copyFromTab(format);
    },
    onSelectTrack: (index) => void copyFromTab(undefined, index)
  });
  buttonHost.appendChild(button.element);

  function refreshButton(): void {
    button.setLabel(getButtonLabel());
    button.setHasOptions(hasMenuOptions(getMenuModel()));
  }

  function syncFormatControls(): void {
    const enabled = readEnabledFormats();
    formatChecks.forEach((c) => {
      c.disabled = c.checked && enabled.length === 1;
    });
  }

  try {
    const data = (await browser.storage.local.get(null)) as Partial<Settings>;
    const loaded = { ...getDefaultSettings(), ...data };
    const enabled = getEnabledFormats(loaded);
    formatChecks.forEach((c) => {
      c.checked = enabled.includes(c.value as CaptionFormat);
    });
    lastFormat = loaded.format;
    showLanguagesToggle.checked = loaded.showLanguages;
    shortcutToggle.checked = loaded.shortcutEnabled;
    shortcut = loaded.shortcut;
    buttonTextInput.value = loaded.buttonText;
    cleanTextToggle.checked = loaded.cleanText;
    includeHeaderToggle.checked = loaded.includeHeader;
  } catch (err) {
    console.warn('Error loading settings:', err);
  }

  function setShortcutHint(text: string, isError = false): void {
    shortcutHint.textContent = text;
    shortcutHint.classList.toggle('error', isError);
  }

  function renderShortcut(): void {
    shortcutRecorder.hidden = !shortcutToggle.checked;
    shortcutDisplay.classList.toggle('recording', recording);
    if (recording) {
      shortcutDisplay.textContent = 'Press keys…';
      return;
    }
    if (!shortcut) {
      shortcutDisplay.textContent = 'Not set';
      return;
    }
    shortcutDisplay.replaceChildren(
      ...shortcutKeys(shortcut).flatMap((key, i) => {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        return i === 0 ? [kbd] : [document.createTextNode('+'), kbd];
      })
    );
  }

  async function applyShortcut(next: string): Promise<boolean> {
    try {
      await browser.commands.update({ name: COPY_COMMAND, shortcut: next });
      return true;
    } catch (err) {
      setShortcutHint(err instanceof Error ? err.message : 'That shortcut is not available.', true);
      return false;
    }
  }

  function stopRecording(): void {
    recording = false;
    document.removeEventListener('keydown', onRecordKey, true);
    renderShortcut();
  }

  async function onRecordKey(e: KeyboardEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      stopRecording();
      setShortcutHint(idleHint);
      return;
    }

    const result = eventToShortcut(e);
    if (!result) return;
    if ('error' in result) {
      setShortcutHint(result.error, true);
      return;
    }

    stopRecording();
    if (!(await applyShortcut(result.shortcut))) return;
    shortcut = result.shortcut;
    renderShortcut();
    setShortcutHint(idleHint);
    void browser.storage.local.set({ shortcut });
  }

  shortcutDisplay.addEventListener('click', () => {
    if (!canUpdateShortcut) {
      void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
      return;
    }
    if (recording) {
      stopRecording();
      setShortcutHint(idleHint);
      return;
    }
    recording = true;
    setShortcutHint('Press the new key combination, or Esc to cancel');
    renderShortcut();
    document.addEventListener('keydown', onRecordKey, true);
  });

  shortcutDisplay.addEventListener('blur', () => {
    if (!recording) return;
    stopRecording();
    setShortcutHint(idleHint);
  });

  if (!canUpdateShortcut) {
    try {
      const commands = await browser.commands.getAll();
      shortcut = commands.find((c) => c.name === COPY_COMMAND)?.shortcut ?? '';
    } catch (err) {
      console.warn('Error reading shortcut:', err);
    }
    shortcutDisplay.title = 'Change shortcut';
    setShortcutHint(idleHint);
  }

  syncFormatControls();
  refreshButton();
  renderShortcut();

  try {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    activeTabId = activeTab?.id ?? null;
    const url = activeTab?.url ?? '';
    if (url.includes('youtube.com/watch')) {
      button.setDisabled(false);
      await refreshMenuInfo();
      refreshButton();
    } else {
      button.setDisabled(true, 'Open a YouTube video to copy its captions');
    }
  } catch {
    button.setDisabled(true, 'Open a YouTube video to copy its captions');
  }

  function saveSettings(): void {
    const newSettings: Omit<Settings, 'format'> = {
      enabledFormats: readEnabledFormats(),
      showLanguages: showLanguagesToggle.checked,
      shortcutEnabled: shortcutToggle.checked,
      shortcut,
      buttonText: getButtonLabel(),
      cleanText: cleanTextToggle.checked,
      includeHeader: includeHeaderToggle.checked
    };

    refreshButton();
    void browser.storage.local.set(newSettings);
  }

  formatChecks.forEach((c) => {
    c.addEventListener('change', () => {
      syncFormatControls();
      saveSettings();
    });
  });
  cleanTextToggle.addEventListener('change', saveSettings);
  includeHeaderToggle.addEventListener('change', saveSettings);
  showLanguagesToggle.addEventListener('change', saveSettings);
  shortcutToggle.addEventListener('change', () => {
    if (recording) stopRecording();
    setShortcutHint(idleHint);
    renderShortcut();
    saveSettings();
  });
  buttonTextInput.addEventListener('input', () => button.setLabel(getButtonLabel()));
  buttonTextInput.addEventListener('input', debounce(saveSettings, 400));
});
