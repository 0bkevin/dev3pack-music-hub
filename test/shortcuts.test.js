import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMacPlatform, shortcutHint, isCommandSearchEvent } from '../src/lib/shortcuts.js';

describe('Cross-platform keyboard shortcut matching (macOS / Windows / Linux)', () => {
  it('detects macOS vs Windows/Linux platform labels correctly', () => {
    assert.equal(isMacPlatform({ platform: 'MacIntel' }), true);
    assert.equal(shortcutHint({ platform: 'MacIntel' }), '⌘K');
    assert.equal(shortcutHint({ userAgentData: { platform: 'macOS' } }), '⌘K');

    assert.equal(isMacPlatform({ platform: 'Win32' }), false);
    assert.equal(shortcutHint({ platform: 'Win32' }), 'Ctrl K');
    assert.equal(shortcutHint({ userAgentData: { platform: 'Windows' } }), 'Ctrl K');

    assert.equal(isMacPlatform({ platform: 'Linux x86_64' }), false);
    assert.equal(shortcutHint({ platform: 'Linux x86_64' }), 'Ctrl K');
    assert.equal(shortcutHint({ userAgentData: { platform: 'Linux' } }), 'Ctrl K');
  });

  it('triggers on Cmd+K (macOS) and Ctrl+K (Windows/Linux) including non-Latin layouts', () => {
    // macOS Cmd+K
    assert.equal(isCommandSearchEvent({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, code: 'KeyK', key: 'k' }), true);
    // Windows / Linux Ctrl+K
    assert.equal(isCommandSearchEvent({ metaKey: false, ctrlKey: true, altKey: false, shiftKey: false, code: 'KeyK', key: 'k' }), true);
    // Non-Latin keyboard layout (e.g. Cyrillic 'л' on physical KeyK)
    assert.equal(isCommandSearchEvent({ metaKey: false, ctrlKey: true, altKey: false, shiftKey: false, code: 'KeyK', key: 'л' }), true);
    // AltGr / Ctrl+Alt+K must NOT trigger
    assert.equal(isCommandSearchEvent({ metaKey: false, ctrlKey: true, altKey: true, shiftKey: false, code: 'KeyK', key: 'k' }), false);
    // Shift+Ctrl+K must NOT trigger
    assert.equal(isCommandSearchEvent({ metaKey: false, ctrlKey: true, altKey: false, shiftKey: true, code: 'KeyK', key: 'K' }), false);
    // Plain 'k' without modifier must NOT trigger
    assert.equal(isCommandSearchEvent({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, code: 'KeyK', key: 'k' }), false);
  });

  it('triggers on "/" outside inputs and ignores "/" while typing in inputs', () => {
    assert.equal(
      isCommandSearchEvent({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, code: 'Slash', key: '/', target: { tagName: 'BODY' } }),
      true
    );
    assert.equal(
      isCommandSearchEvent({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, code: 'Slash', key: '/', target: { tagName: 'INPUT' } }),
      false
    );
    assert.equal(
      isCommandSearchEvent({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, code: 'Slash', key: '/', target: { tagName: 'TEXTAREA' } }),
      false
    );
    assert.equal(
      isCommandSearchEvent({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, code: 'Slash', key: '/', target: { tagName: 'DIV', isContentEditable: true } }),
      false
    );
  });
});
