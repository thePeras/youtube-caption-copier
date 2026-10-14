import { COPY_COMMAND, COPY_SHORTCUT, getDefaultSettings, type RuntimeMessage, type Settings } from './shared';

async function initDefaults(): Promise<void> {
  try {
    const stored: Partial<Settings> = await browser.storage.local.get(null);
    const defaults = getDefaultSettings();
    const updates: Partial<Settings> = {};
    for (const key of Object.keys(defaults) as (keyof Settings)[]) {
      if (stored[key] === undefined) {
        Object.assign(updates, { [key]: defaults[key] });
      }
    }
    if (Object.keys(updates).length > 0) {
      await browser.storage.local.set(updates);
    }
  } catch (err) {
    console.warn('[YT Caption Copier] Error initializing storage:', err);
  }
}

async function applyShortcut(): Promise<void> {
  try {
    const { shortcutEnabled, shortcut } = (await browser.storage.local.get(['shortcutEnabled', 'shortcut'])) as Partial<Settings>;
    await browser.commands.update({ name: COPY_COMMAND, shortcut: shortcutEnabled ? shortcut || COPY_SHORTCUT : '' });
  } catch (err) {
    console.warn('[YT Caption Copier] Error updating shortcut:', err);
  }
}

browser.runtime.onInstalled.addListener(async () => {
  await initDefaults();
  await applyShortcut();
});

browser.runtime.onStartup.addListener(() => {
  void applyShortcut();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ('shortcutEnabled' in changes || 'shortcut' in changes)) {
    void applyShortcut();
  }
});

browser.commands.onCommand.addListener(async (command: string) => {
  if (command !== COPY_COMMAND) return;
  try {
    const { shortcutEnabled } = await browser.storage.local.get('shortcutEnabled');
    if (!shortcutEnabled) return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined && tab.url?.includes('youtube.com/watch')) {
      const message: RuntimeMessage = { action: 'trigger-copy-captions' };
      await browser.tabs.sendMessage(tab.id, message);
    }
  } catch (err) {
    console.warn('[YT Caption Copier] Command error:', err);
  }
});
