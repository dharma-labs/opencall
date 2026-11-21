// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// OpenCall's desktop shell adds no commands and no network stack: the UI is the
/// same static build that runs in a browser, and every byte still moves over the
/// peer-to-peer WebRTC session.
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to start the OpenCall window");
}
