# Image Compressor

A lightweight desktop app for compressing JPG and PNG images, built with [Tauri 2](https://tauri.app/), React, TypeScript, and Rust.

## Features

- **Drag & drop** images directly onto the window
- **JPEG compression** with adjustable quality (10–100%)
- **PNG optimization** using [oxipng](https://github.com/shssoichiro/oxipng) with Zopfli encoding
- **Batch compress** all pending images at once
- **Save individually** or **save all** compressed files to a folder
- Live stats: file count, bytes saved, and overall reduction percentage
- Duplicate detection — dropping the same file twice is a no-op

## Supported Formats

| Format | Method |
|--------|--------|
| JPEG / JPG | Re-encode with adjustable quality |
| PNG | Lossless optimization via oxipng (preset 3 + Zopfli) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2 |
| Frontend | React 18 + TypeScript + Vite |
| Backend | Rust (`image`, `oxipng`, `uuid`) |

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- Tauri prerequisites for your OS — see the [Tauri setup guide](https://tauri.app/start/prerequisites/)

## Getting Started

```bash
# Install frontend dependencies
npm install

# Run in development mode
npm run tauri dev

# Build a production binary
npm run tauri build
```

The compiled app will be placed in `src-tauri/target/release/bundle/`.

## Usage

1. **Add images** — drag and drop JPG or PNG files onto the window.
2. **Adjust quality** — use the JPEG Quality slider in the toolbar (affects JPEG only).
3. **Compress** — click **Compress** on a single image, or **Compress All** for everything.
4. **Save** — click **Save** to export one file, or **Save All** to batch-export to a folder.
   Saved files are named `<original>_compressed.<ext>`.

## License

MIT
