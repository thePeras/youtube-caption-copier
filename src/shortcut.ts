export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

const NAMED_KEYS: Record<string, string> = {
  Comma: 'Comma',
  Period: 'Period',
  Space: 'Space',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
};

const MODIFIER_CODES = new Set(['AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight']);

const DISPLAY_NAMES: Record<string, string> = IS_MAC
  ? { Alt: '⌥ Option', Command: '⌘ Cmd', MacCtrl: '⌃ Ctrl', Shift: '⇧ Shift', Ctrl: '⌘ Cmd' }
  : { Alt: 'Alt', Ctrl: 'Ctrl', Shift: 'Shift' };

export type RecordResult = { shortcut: string } | { error: string } | null;

function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return NAMED_KEYS[code] ?? null;
}

export function eventToShortcut(e: KeyboardEvent): RecordResult {
  if (MODIFIER_CODES.has(e.code)) return null;

  const key = keyFromCode(e.code);
  if (!key) return { error: 'That key cannot be used in a shortcut.' };

  const modifiers: string[] = [];
  if (e.altKey) modifiers.push('Alt');
  if (IS_MAC) {
    if (e.metaKey) modifiers.push('Command');
    if (e.ctrlKey) modifiers.push('MacCtrl');
  } else if (e.ctrlKey) {
    modifiers.push('Ctrl');
  }

  const isFunctionKey = /^F\d+$/.test(key);
  if (modifiers.length === 0 && !isFunctionKey) {
    return { error: IS_MAC ? 'Include ⌥ Option, ⌘ Cmd or ⌃ Ctrl.' : 'Include Alt or Ctrl.' };
  }
  if (modifiers.length > 2) return { error: 'Use at most two modifier keys.' };
  if (e.shiftKey) modifiers.push('Shift');

  return { shortcut: [...modifiers, key].join('+') };
}

export function shortcutKeys(shortcut: string): string[] {
  return shortcut
    .split('+')
    .filter(Boolean)
    .map((part) => DISPLAY_NAMES[part] ?? part);
}
