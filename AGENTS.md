# YaWeRead

An English-learning assistant desktop app powered by WeRead (微信读书) data, built with Tauri v2.

## Tech Stack

- **Frontend**: React 19 + TypeScript, Vite 7
- **Backend**: Rust 2024 edition, Tauri v2
- **Target**: macOS desktop (WKWebView)

## Architecture

### WebView Bridge Pattern

The app cannot use standard Tauri IPC with WeRead because Tauri only injects its IPC layer into pages served from the Tauri origin — external pages (weread.qq.com) have no access to `window.__TAURI_INTERNALS__`.

Instead, we use a **navigation-interception bridge**:

1. Rust creates a hidden `WebviewWindow` loading `https://weread.qq.com`
2. Rust injects JS via `win.eval()` that does `fetch()` with `{ credentials: 'include' }` (HttpOnly cookies auto-attached by WKWebView)
3. JS sends results back by navigating: `window.location.href = 'https://yaweread.local/cb?d=' + encodeURIComponent(data)`
4. Rust's `on_navigation` callback intercepts `yaweread.local` URLs, blocks the navigation, and emits the payload as a Tauri event (`weread-data`)
5. React frontend listens for the `weread-data` event to receive API responses

### WeRead API Pitfalls

WeRead has two API prefixes that behave **differently** depending on the client:

| API Path | Chromium (Dia) | WKWebView (Tauri) |
|---|---|---|
| `/web/user/config` | 200 ✅ | 404 ❌ |
| `/api/user/config` | 404 ❌ | 200 ✅ |
| `/web/shelf/sync` | 200 ✅ | 200 ✅ |
| `/web/book/bookmarklist` | 200 ✅ | 200 ✅ |
| `/web/review/list` | 200 ✅ | 200 ✅ |

**Rule**: Use `/api/user/config` for login detection. Use `/web/` prefix for all data APIs (shelf, bookmarks, reviews).

### Cookie Behavior in WKWebView

- `document.cookie` does **NOT** contain `wr_name`, `wr_vid`, or `wr_skey` — these are either HttpOnly or not set by the SPA in this context
- `document.cookie` only has: `wr_gid`, `wr_ql`, `wr_fp`
- **Never rely on `document.cookie` for login detection** — always use an API call
- HttpOnly cookies (wr_vid, wr_skey) ARE sent with `fetch()` requests when `credentials: 'include'` is set
- `NSHTTPCookieStorage.sharedHTTPCookieStorage` does NOT contain WKWebView cookies — they live in `WKWebsiteDataStore`

### on_navigation Behavior

- Only fires for **top-level document navigations** (e.g., `window.location.href = ...`)
- Does **NOT** fire for sub-resource requests (`new Image().src`, `fetch()`, XHR)
- Does **NOT** fire for custom URL schemes (`yaweread://...`) — use `https://` with a fake domain instead
- Returns `false` to block navigation (page stays on current URL)
- The initial page load URL (`https://weread.qq.com`) DOES trigger it

### Data Flow

```
React (invoke) → Rust (eval JS into webview) → WKWebView (fetch API + navigate to yaweread.local)
     ↑                                                              |
     └── listen("weread-data") ← Rust (on_navigation intercept + emit) ←─┘
```

## Development

```bash
pnpm install
pnpm tauri dev      # Dev mode (fresh WKWebView session, no prior cookies)
pnpm tauri build    # Production build
```

**Note**: `pnpm tauri dev` starts with a clean WKWebView — you must scan QR to log in. The bundled `.app` shares cookies with the system WKWebView store, so it may auto-login if previously authenticated.

## File Structure

```
src/                    # React frontend
  App.tsx               # Main app: login flow, shelf, book detail views
  App.css               # Styles
src-tauri/
  src/lib.rs            # Tauri commands: open_weread, check_login, weread_fetch, show/hide/logout
  src/weread.rs         # Reserved for future WeRead-specific logic
  src/main.rs           # Entry point
  tauri.conf.json       # Tauri config (window size, CSP, etc.)
  capabilities/         # Tauri v2 permission capabilities
```

## Conventions

- Rust edition 2024; avoid `unsafe` unless absolutely necessary
- Frontend uses plain React state (no state management library)
- All WeRead API calls go through the `weread_fetch` command + `waitForData()` event pattern — never call WeRead APIs directly from the frontend
- Commit messages in English, detailed
