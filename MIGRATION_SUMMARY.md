# Migration Summary

The four JavaScript files are new WebView2 replacements for the extension runtime. The extension-only manifest, background page, content script, popup UI, and legacy utility layer can now be removed from this repository once the Avalonia host uses these files.

## Removed extension runtime dependencies

The refactored layer does not depend on `chrome.runtime.sendMessage`, `chrome.runtime.onMessage`, `chrome.storage`, `chrome.tabs`, `chrome.debugger`, `chrome.scripting`, `chrome.action`, or `chrome.runtime.getURL`.

The page/host boundary is `window.chrome.webview.postMessage(...)` and WebView2's `message` event.

## Content integration

`refactored-content.js` replaces the old page-context `a.js` + `content.js` coordination for Chess.com and Lichess. It reads Chess.com state from the page game object and uses the Lichess move source hook instead of the extension debugger breakpoint path.

It continuously observes the board, orientation, turn, FEN transitions, legal-move DOM state, and move events. Host commands can supply settings, evaluations, best moves, book moves, overlays, and move requests.

## Engine integration

`refactored-engine-worker.js` is a dedicated Web Worker host for Komodo, Stockfish 6, Stockfish 11, Lozza, Wukong, Torch, and Maia 3.

Classic engine scripts are loaded from the existing `lib/` assets. Komodo and Torch paths are patched to use the WebView2 asset base instead of extension URLs.

Maia 3 loads ONNX Runtime, the existing model, and `all_moves.json` directly in the worker. The tokenization and legal-move mask logic required by Maia 3 is embedded in this worker, so the old Maia helper scripts are no longer required.

## Opening book

`refactored-book.js` is a standalone WebView2 book bridge. It sends FEN queries to C# as `BOOK_LOOKUP` and correlates `BOOK_RESULT` / `BOOK_ERROR` responses by request ID.

The C# host should read `book/book.bin` as the Polyglot book and return move objects such as `{ from, to, uci, eval: "book", fen, rank }`.

## Loader

`bridge-loader.js` is the document-created entry point intended for `CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync()`.

The host should provide `window.__SOLIS_WEBVIEW_CONFIG__` with an `assetBase` or explicit script URLs so the loader can locate its worker and supporting assets.

## Assets that remain required

`lib/chess_min.js`
`lib/komodo.js`
`lib/komodo.wasm`
`lib/stockfish6.js`
`lib/stockfish11.js`
`lib/lozza.js`
`lib/wukong.js`
`lib/torch.js`
`lib/torch.wasm`
`lib/maia3/all_moves.json`
`lib/maia3/maia3-5m.onnx`
`lib/ort/*`
`book/book.bin`

## Files removed as obsolete

The extension runtime files `manifest.json`, `background.js`, `content.js`, and `a.js` are obsolete.

The extension popup tree and `utils/*` tree are obsolete because the desktop Avalonia application owns settings and UI and the required helper logic is contained in the new bridge files.

Unused Maia helper files and temporary marker files are also removed: `lib/maia3/all_moves_reversed.json`, `lib/maia3/maia3-engine.js`, `lib/maia3/maia3-tokenizer.js`, `lib/maia3/maia3-worker.js`, `book/mamaa`, and `lib/ort/t`.

The engine/model/ORT runtime assets themselves are retained.