mod weread;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, Emitter};

#[tauri::command]
async fn open_weread(app: tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("weread").is_some() {
        return Ok(());
    }

    let url = WebviewUrl::External("https://weread.qq.com".parse().unwrap());
    let app_handle = app.clone();
    let _win = WebviewWindowBuilder::new(&app, "weread", url)
        .title("微信读书")
        .inner_size(400.0, 580.0)
        .visible(false)
        .on_navigation(move |url| {
            let url_str = url.as_str();
            if url_str.starts_with("https://yaweread.local/") {
                if let Some(query) = url.query() {
                    let data = query.strip_prefix("d=")
                        .map(|s| percent_decode(s))
                        .unwrap_or_default();
                    let _ = app_handle.emit("weread-data", data);
                }
                return false; // Block - stays on current page
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn percent_decode(s: &str) -> String {
    let mut result = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""),
                16,
            ) {
                result.push(byte);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            result.push(b' ');
            i += 1;
            continue;
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&result).to_string()
}

#[tauri::command]
async fn check_login(app: tauri::AppHandle) -> Result<(), String> {
    let win = app.get_webview_window("weread")
        .ok_or("WeRead webview not found")?;

    // Don't check cookies (wr_name may not exist in WKWebView).
    // Instead, call an API that only succeeds when logged in.
    win.eval(r#"
        (async function() {
            try {
                var resp = await fetch('https://weread.qq.com/api/user/config', { credentials: 'include' });
                if (resp.ok) {
                    var data = await resp.json();
                    if (data && !data.errCode) {
                        window.location.href = 'https://yaweread.local/cb?d=' + encodeURIComponent(JSON.stringify({ loggedIn: true }));
                        return;
                    }
                }
            } catch(e) {}
            window.location.href = 'https://yaweread.local/cb?d=' + encodeURIComponent(JSON.stringify({ loggedIn: false }));
        })();
    "#).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn weread_fetch(api_path: String, app: tauri::AppHandle) -> Result<(), String> {
    let win = app.get_webview_window("weread")
        .ok_or("WeRead webview not found")?;

    let js = format!(r#"
        (async function() {{
            try {{
                var resp = await fetch('https://weread.qq.com{path}', {{ credentials: 'include' }});
                var data = await resp.text();
                window.location.href = 'https://yaweread.local/cb?d=' + encodeURIComponent(data);
            }} catch(e) {{
                window.location.href = 'https://yaweread.local/cb?d=' + encodeURIComponent(JSON.stringify({{error: e.message}}));
            }}
        }})();
    "#, path = api_path);

    win.eval(&js).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn show_login(app: tauri::AppHandle) -> Result<(), String> {
    let win = app.get_webview_window("weread")
        .ok_or("WeRead webview not found")?;
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn hide_weread(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("weread") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn logout(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("weread") {
        let _ = win.close();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_weread,
            check_login,
            weread_fetch,
            show_login,
            hide_weread,
            logout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
