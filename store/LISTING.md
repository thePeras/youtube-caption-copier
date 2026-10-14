# Chrome Web Store submission

Package: `youtube-caption-copier-chrome.zip` (built with `npm run package:chrome`)

## Store listing

**Name:** YouTube Caption Copier

**Summary** (from manifest): YouTube styled button to copy captions to clipboard of the active video.

**Category:** Productivity → Tools

**Language:** English

**Description:**

```
YouTube Caption Copier adds a Captions button to YouTube's action bar, styled like the built-in Share and Save buttons, in light and dark mode.

Click it and the video's captions are copied to your clipboard. It uses the same caption language YouTube picks for you.

Features
• One-click copy of the video's captions
• Three formats: readable paragraphs, timestamped lines, or SRT subtitles
• Choose which formats appear in the button's dropdown
• Optional language picker listing every caption track
• Optional cleanup of words repeated across caption lines
• Optional title and URL header
• Optional keyboard shortcut (default Alt+C, change it at chrome://extensions/shortcuts)

The extension only runs on youtube.com and does not collect or send any data.
```

**Graphic assets:**

| Field | File |
| --- | --- |
| Store icon (128×128) | `public/icons/icon-128.png` |
| Screenshot 1 (1280×800) | `store/screenshot-1-button.png` |
| Screenshot 2 (1280×800) | `store/screenshot-2-settings.png` |
| Small promo tile (440×280) | `store/promo-small-440x280.png` |

## Privacy practices tab

**Single purpose:**

```
Copy the captions of the YouTube video you are watching to the clipboard, via a button added to the YouTube page.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's settings (caption format, language picker, button label, shortcut on/off) locally. |
| `clipboardWrite` | Writes the copied captions to the clipboard when the user clicks the Captions button or uses the shortcut. |
| Host permission `*://*.youtube.com/*` | Adds the Captions button to YouTube video pages and reads the video's caption tracks from YouTube to copy them. |

**Remote code:** No, I am not using remote code. All JavaScript is bundled in the package.

**Data usage:** Leave every data type unchecked (the extension collects no user data), then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** not required when no data is collected. If the dashboard asks for one, host a page stating: "YouTube Caption Copier does not collect, store remotely, or transmit any personal data. Settings are kept in the browser's local extension storage."

## Distribution

- Visibility: Public
- Regions: All regions
- Pricing: Free
