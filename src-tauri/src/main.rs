#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod geo;
mod traceroute;

use traceroute::{new_handle, ProcessHandle, TraceParams};
use geo::fetch_geo;

// ── Estado da aplicação ───────────────────────────────────────────────────────

struct AppState {
    trace_handle: ProcessHandle,
}

// ── Controles de janela ───────────────────────────────────────────────────────

#[tauri::command]
async fn window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
async fn window_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
async fn window_close(window: tauri::Window) {
    let _ = window.close();
}

// ── Traceroute ────────────────────────────────────────────────────────────────

#[tauri::command]
async fn start_traceroute(
    app:    tauri::AppHandle,
    state:  tauri::State<'_, AppState>,
    params: TraceParams,
) -> Result<(), String> {
    // Encerra qualquer trace em andamento antes de iniciar novo
    traceroute::stop(state.trace_handle.clone()).await;

    let handle = state.trace_handle.clone();
    tokio::spawn(async move {
        traceroute::run(app, params, handle).await;
    });

    Ok(())
}

#[tauri::command]
async fn stop_traceroute(state: tauri::State<'_, AppState>) -> Result<(), String> {
    traceroute::stop(state.trace_handle.clone()).await;
    Ok(())
}

// ── Geo lookup (painel de info) ───────────────────────────────────────────────

#[tauri::command]
async fn geo_lookup(ip: String) -> Result<geo::GeoInfo, String> {
    Ok(fetch_geo(&ip).await)
}

// ── Abertura de URL externa (lista de permissões) ─────────────────────────────

#[tauri::command]
fn open_external(url: String) {
    let allowed = url.starts_with("https://who.is")
        || url.starts_with("https://www.arin.net")
        || url.starts_with("https://search.arin.net")
        || url.starts_with("https://stat.ripe.net")
        || url.starts_with("https://bgp.he.net")
        || url.starts_with("https://ipinfo.io");

    if !allowed { return; }

    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("cmd").args(["/C", "start", "", &url]).spawn(); }

    #[cfg(target_os = "macos")]
    { let _ = std::process::Command::new("open").arg(&url).spawn(); }

    #[cfg(target_os = "linux")]
    { let _ = std::process::Command::new("xdg-open").arg(&url).spawn(); }
}

// ── Main ──────────────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .manage(AppState { trace_handle: new_handle() })
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_maximize,
            window_close,
            start_traceroute,
            stop_traceroute,
            geo_lookup,
            open_external,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar TraceVis");
}
