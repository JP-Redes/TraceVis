//! Cross-platform traceroute: spawns OS command, parses output line-by-line,
//! enriches each hop with geo data and emits Tauri events.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use std::sync::Arc;

use crate::geo::{fetch_geo, reverse_dns, GeoInfo};

#[derive(Debug, Clone, Deserialize)]
pub struct TraceParams {
    pub target:      String,
    pub resolve_dns: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct HopData {
    pub hop:      u32,
    pub ip:       Option<String>,
    pub hostname: Option<String>,
    pub timeout:  bool,
    pub rtt:      Option<f64>,
    pub rtts:     Vec<Option<f64>>,
    pub geo:      Option<GeoInfo>,
}

pub type ProcessHandle = Arc<Mutex<Option<tokio::process::Child>>>;

pub fn new_handle() -> ProcessHandle {
    Arc::new(Mutex::new(None))
}

// ── Build OS command ──────────────────────────────────────────────────────────
// Using if/else cfg!() instead of #[cfg] attribute blocks to avoid the
// "unreachable code" warning the compiler emits when a #[cfg] block contains
// a `return` and more code follows.

fn build_command(target: &str, resolve_dns: bool) -> (String, Vec<String>) {
    let is_ipv6 = target.contains(':');

    if cfg!(target_os = "windows") {
        let mut args = vec![
            "-w".to_string(), "3000".to_string(),
            "-h".to_string(), "30".to_string(),
        ];
        if !resolve_dns { args.push("-d".to_string()); }
        args.push(target.to_string());
        ("tracert".to_string(), args)

    } else if cfg!(target_os = "macos") {
        let cmd = if is_ipv6 { "traceroute6" } else { "traceroute" };
        let mut args = vec![
            "-m".to_string(), "30".to_string(),
            "-w".to_string(), "3".to_string(),
        ];
        if !resolve_dns { args.push("-n".to_string()); }
        args.push(target.to_string());
        (cmd.to_string(), args)

    } else {
        // Linux / other Unix
        let mut args = vec![
            "-m".to_string(), "30".to_string(),
            "-w".to_string(), "3".to_string(),
        ];
        if is_ipv6  { args.push("-6".to_string()); }
        if !resolve_dns { args.push("-n".to_string()); }
        args.push(target.to_string());
        ("traceroute".to_string(), args)
    }
}

// ── Extract a valid IP from a single token ────────────────────────────────────

fn extract_ip(token: &str) -> Option<String> {
    let t = token.trim_matches(|c| c == '[' || c == ']' || c == '(' || c == ')');

    // IPv4: four dotted decimal octets, each 0-255
    let parts: Vec<&str> = t.split('.').collect();
    if parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok()) {
        return Some(t.to_string());
    }

    // IPv6: at least two colons
    if t.contains(':') && t.chars().filter(|&c| c == ':').count() >= 2 {
        return Some(t.to_string());
    }

    None
}

fn parse_rtt(s: &str) -> Option<f64> {
    let s = s.trim();
    if s == "*"  { return None; }
    if s == "<1" { return Some(0.5); }
    s.parse::<f64>().ok()
}

fn timeout_hop(hop_num: u32) -> HopData {
    HopData { hop: hop_num, ip: None, hostname: None, timeout: true, rtt: None, rtts: vec![], geo: None }
}

// ── Windows parser ────────────────────────────────────────────────────────────
//
// BUG FIXED: `rest.starts_with("* * *")` never matched real tracert output
// because Windows writes multiple spaces between asterisks:
//   "  5     *        *        *     Request timed out."
// Fix: tokenize first, then check whether the first three non-"ms" tokens
// are all "*".
//
// Also handles PT-BR locale timeout phrase "Tempo limite ... esgotado."

fn parse_windows_line(line: &str) -> Option<HopData> {
    let trimmed = line.trim();
    let hop_num: u32 = trimmed.split_whitespace().next()?.parse().ok()?;
    let rest = trimmed[hop_num.to_string().len()..].trim();
    if rest.is_empty() { return None; }

    let tokens: Vec<&str> = rest.split_whitespace().collect();
    let non_ms: Vec<&str> = tokens.iter().filter(|&&t| t != "ms").copied().collect();

    // Detect all-timeout line
    let is_timeout = non_ms.iter().take(3).all(|&t| t == "*")
        || rest.to_ascii_lowercase().contains("timed out")
        || rest.to_ascii_lowercase().contains("esgotado")
        || rest.to_ascii_lowercase().contains("esgotou")
        || rest.to_ascii_lowercase().contains("timeout");

    if is_timeout { return Some(timeout_hop(hop_num)); }

    let mut rtts: Vec<Option<f64>> = Vec::new();
    let mut ip: Option<String>      = None;
    let mut hostname: Option<String> = None;
    let mut i = 0;

    while i < tokens.len() {
        let t = tokens[i];

        if t == "*" {
            if rtts.len() < 3 { rtts.push(None); }
            i += 1;
            continue;
        }

        if t == "ms" {
            if i > 0 && rtts.len() < 3 {
                let prev = tokens[i - 1];
                if prev != "ms" && prev != "*" {
                    rtts.push(parse_rtt(prev));
                }
            }
            i += 1;
            continue;
        }

        let stripped = t.trim_matches(|c| c == '(' || c == ')' || c == '[' || c == ']');
        if ip.is_none() {
            if let Some(extracted) = extract_ip(stripped) {
                ip = Some(extracted);
                i += 1;
                continue;
            }
        }

        if ip.is_none() && hostname.is_none()
            && t.contains('.')
            && !t.chars().all(|c| c.is_ascii_digit() || c == '.')
        {
            hostname = Some(t.to_string());
        }

        i += 1;
    }

    let ip = ip?;
    let valid: Vec<f64> = rtts.iter().filter_map(|r| *r).collect();
    let rtt = if valid.is_empty() { None } else {
        Some((valid.iter().sum::<f64>() / valid.len() as f64 * 10.0).round() / 10.0)
    };

    Some(HopData {
        hop: hop_num, ip: Some(ip.clone()),
        hostname: hostname.or(Some(ip)), timeout: false, rtt, rtts, geo: None,
    })
}

// ── Unix parser ───────────────────────────────────────────────────────────────
//
// BUG FIXED: original only caught all-timeout with `rest == "*"` (single star).
// A two-star line ("* *") would fall through; `ip?` returned None and the hop
// was silently dropped, making hop numbers inconsistent in the sidebar.

fn parse_unix_line(line: &str) -> Option<HopData> {
    let trimmed = line.trim();
    let hop_num: u32 = trimmed.split_whitespace().next()?.parse().ok()?;
    let rest = trimmed[hop_num.to_string().len()..].trim();

    let tokens: Vec<&str> = rest.split_whitespace().collect();
    if tokens.is_empty() { return None; }

    if tokens.iter().all(|&t| t == "*") {
        return Some(timeout_hop(hop_num));
    }

    let mut ip: Option<String>       = None;
    let mut hostname: Option<String>  = None;

    for t in &tokens {
        let stripped = t.trim_matches(|c| c == '(' || c == ')' || c == '[' || c == ']');
        if let Some(extracted) = extract_ip(stripped) {
            ip = Some(extracted);
            break;
        }
    }

    if let Some(ref ip_str) = ip {
        let pattern = format!("({})", ip_str);
        if let Some(pos) = rest.find(&pattern) {
            let host_part = rest[..pos].trim();
            if let Some(first_word) = host_part.split_whitespace().next() {
                if !first_word.is_empty() && first_word != ip_str.as_str() {
                    hostname = Some(first_word.to_string());
                }
            }
        }
    }

    let ip = match ip {
        Some(v) => v,
        None    => return Some(timeout_hop(hop_num)), // partial timeout, no IP
    };

    let rtt_re = regex_lite::Regex::new(r"(\d+\.?\d*)\s*ms").unwrap();
    let rtts: Vec<Option<f64>> = rtt_re.captures_iter(rest).take(3)
        .map(|c| c[1].parse::<f64>().ok()).collect();

    let valid: Vec<f64> = rtts.iter().filter_map(|r| *r).collect();
    let rtt = if valid.is_empty() { None } else {
        Some((valid.iter().sum::<f64>() / valid.len() as f64 * 10.0).round() / 10.0)
    };

    Some(HopData {
        hop: hop_num, ip: Some(ip.clone()),
        hostname: hostname.or(Some(ip)), timeout: false, rtt, rtts, geo: None,
    })
}

fn parse_line(line: &str) -> Option<HopData> {
    if cfg!(target_os = "windows") { parse_windows_line(line) } else { parse_unix_line(line) }
}

// ── Main run function ─────────────────────────────────────────────────────────
//
// BUG FIXED (1 — stop mechanism):
//   Original stored nothing in the handle (comment admitted: "We can't store
//   the child itself easily after taking stdout"). Fix: take stdout first,
//   then store the remaining child struct in the handle.
//
// BUG FIXED (2 — UTF-8 crash on Windows PT-BR locale):
//   `tracert` header on Brazilian Windows contains characters like "á" encoded
//   in CP850 (e.g. "com no máximo 30 saltos:"). `BufReader::lines()` returns
//   Err on the first non-UTF-8 byte, which exits the loop immediately → 0 hops.
//   Fix: use `read_until(b'\n')` with raw bytes and `String::from_utf8_lossy`
//   so invalid bytes are replaced with '?' instead of causing a fatal error.
//   IP addresses and RTT values are always ASCII, so parsing is unaffected.

pub async fn run(app: AppHandle, params: TraceParams, handle: ProcessHandle) {
    let (cmd, args) = build_command(&params.target, params.resolve_dns);

    let mut child = match Command::new(&cmd)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(c)  => c,
        Err(e) => {
            let _ = app.emit_all("traceroute-error",
                &format!("Failed to start '{}': {}", cmd, e));
            return;
        }
    };

    // Take stdout BEFORE storing child so stop() can reach and kill the child.
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = app.emit_all("traceroute-error", &"Failed to capture stdout");
            return;
        }
    };

    {
        let mut lock = handle.lock().await;
        *lock = Some(child);
    }

    // Read raw bytes line-by-line; convert with lossy UTF-8 to survive
    // non-ASCII characters in locale-specific tracert/traceroute headers.
    let mut reader  = BufReader::new(stdout);
    let mut raw_buf = Vec::with_capacity(256);
    let resolve_dns = params.resolve_dns;

    loop {
        raw_buf.clear();
        match reader.read_until(b'\n', &mut raw_buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let line = String::from_utf8_lossy(&raw_buf).trim().to_string();
                if line.is_empty() { continue; }

                if let Some(mut hop) = parse_line(&line) {
                    if hop.hop < 1 || hop.hop > 64 { continue; }

                    if let Some(ref ip) = hop.ip.clone() {
                        hop.geo = Some(fetch_geo(ip).await);

                        if resolve_dns
                            && hop.geo.as_ref().map(|g| !g.is_private).unwrap_or(false)
                        {
                            if let Some(rdns) = reverse_dns(ip).await {
                                if hop.hostname.as_deref() == Some(ip.as_str()) {
                                    hop.hostname = Some(rdns);
                                }
                            }
                        }
                    }

                    let _ = app.emit_all("hop-data", &hop);
                }
            }
        }
    }

    // Reclaim child and wait for it to fully exit.
    let child_opt = { let mut lock = handle.lock().await; lock.take() };
    if let Some(mut c) = child_opt { let _ = c.wait().await; }

    let _ = app.emit_all("traceroute-complete", &serde_json::json!({ "code": 0 }));
}

// ── Stop ──────────────────────────────────────────────────────────────────────
//
// BUG FIXED: was always a no-op because the handle was never populated.
// Now that run() stores the child, this correctly kills the process.

pub async fn stop(handle: ProcessHandle) {
    let child_opt = { let mut lock = handle.lock().await; lock.take() };
    if let Some(mut c) = child_opt {
        let _ = c.kill().await;
        let _ = c.wait().await;
    }
}
