# ComfyUI Prompt Collector

A simple desktop app that scans folders with ComfyUI-generated PNG images and extracts all embedded prompts into a browsable, searchable list.

## What it does

- Scans any folder (including subfolders) for PNG images created with ComfyUI
- Reads prompt metadata directly from PNG files — no external databases needed
- Shows all extracted prompts in a list on the left, image thumbnails on the right
- Click an image — jumps to its prompt. Click a prompt — jumps to its image
- One-click copy for any prompt

## Getting started

```bash
git clone https://github.com/E2GO/comfyui-prompt-collector.git
cd comfyui-prompt-collector
npm install
npm start
```

Requires [Node.js](https://nodejs.org/) 18+ installed.

## How to use

0. Start with npm start in projet folder's CMD.
1. Click **Select Folder** (or `File → Select Folder`, `Ctrl+O`) and pick a folder with ComfyUI PNG images
2. Wait for the scan to finish — all prompts appear on the left, thumbnails on the right
3. Click any image thumbnail to highlight its prompt and scroll to it
4. Click the scroll-to-image button (right side of a prompt card) to find the image in the gallery

## Features

### Prompt types

The app extracts three types of data from ComfyUI workflows:

- **Positive** (green) — the main generation prompt
- **Negative** (red) — negative prompt, hidden by default
- **Trigger** (yellow) — LoRA trigger words, hidden by default

Use the checkboxes in the toolbar to show/hide each type.

### Search

Type in the search box to filter prompts by text. Works across all prompt types.

### Sorting

**Long first** button (toolbar) — shows longest prompts at the top of each card. Enabled by default. Toggle it to reverse. Also available via `View → Toggle Prompt Sort Order` (`Ctrl+Shift+S`).

### Auto-copy

When enabled (green), clicking an image automatically copies its first prompt to clipboard. Toggle with the **Auto-copy** button in the toolbar.

### Show in Explorer

When an image is selected, its filename appears above the gallery. Click the folder icon next to it to open the file location in your system file explorer.

### Export

`File → Export` or the **Export** dropdown — save filtered prompts as TXT, CSV, or JSON.

### Gallery size

Use the **Size** slider below the gallery to adjust thumbnail columns (3–9).

### Logs

If something goes wrong, click **Logs** in the bottom status bar (or `Help → Open Log File`) to access diagnostic logs. Logs contain no personal data — only app events, scan statistics, and errors.

## Supported workflows

The parser handles a variety of ComfyUI node types:

- `CLIPTextEncode` — standard positive/negative prompts
- `PrimitiveStringMultiline` / `PrimitiveString` — primitive text nodes
- LoRA loaders — trigger word extraction
- Text input / string input nodes
- Negative prompt detection via KSampler graph tracing

## Tech

- Electron 40
- Custom `thumb://` protocol for fast JPEG thumbnail generation
- Lazy loading with IntersectionObserver
- PNG binary parser (tEXt/iTXt chunks) — no external image libraries

## License

MIT
