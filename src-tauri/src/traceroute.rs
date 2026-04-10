//! Traceroute multiplataforma: executa o comando do SO, parseia linha a linha,
//! enriquece cada hop com dados geo e emite eventos Tauri.
//!
//! Bugs corrigidos em relação à versão original:
//!   1. `devPath`/`distDir` apontavam para `../src` (inexistente); agora `.`.
//!   2. CSP não incluía `https://cloudflare-dns.com`; corrigido em tauri.conf.json.
//!   3. Parser Windows: múltiplos espaços entre `*` impediam detecção de timeout.
//!   4. Parser Unix: linha com 2 `*` (ex.: `* *`) não era detectada como timeout.
//!   5. Stop: `ProcessHandle` nunca era preenchido → kill não funcionava.
//!   6. Crash UTF-8 no Windows PT-BR: `BufReader::lines()` morria no primeiro
//!      byte não-ASCII do cabeçalho do tracert; agora usa `read_until` + lossy.
//!   7. reqwest 0.11 removido; usa 0.12 (sem dependência de OpenSSL no Linux).
//!   8. `lazy_static` removido; usa `std::sync::OnceLock`.
//!   9. `traceroute6` como fallback explícito no macOS para IPv6.
//!  10. Hop de timeout com IP parcial (ex.: `* 1.2.3.4 *`) preservado corretamente.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use std::sync::Arc;

use crate::geo::{fetch_geo, reverse_dns, GeoInfo};

// ── Tipos públicos ─────────────────────────────────────────────────────────────

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

// ── Montagem do comando ────────────────────────────────────────────────────────

fn build_command(target: &str, resolve_dns: bool) -> (String, Vec<String>) {
    let is_ipv6 = target.contains(':');

    if cfg!(target_os = "windows") {
        let mut args = vec![
            "-w".into(), "3000".into(),
            "-h".into(), "30".into(),
        ];
        if !resolve_dns { args.push("-d".into()); }
        args.push(target.to_string());
        ("tracert".into(), args)

    } else if cfg!(target_os = "macos") {
        // No macOS, `traceroute6` é o binário correto para IPv6.
        let cmd = if is_ipv6 { "traceroute6" } else { "traceroute" }.to_string();
        let mut args = vec![
            "-m".into(), "30".into(),
            "-w".into(), "3".into(),
        ];
        if !resolve_dns { args.push("-n".into()); }
        args.push(target.to_string());
        (cmd, args)

    } else {
        // Linux / outro Unix.
        // Tenta usar `traceroute` com flag `-6` para IPv6.
        // Se o pacote instalado for o `inetutils-traceroute` (sem suporte a -6),
        // o processo falhará — nesse caso o usuário deve instalar o pacote
        // `traceroute` (iputils) ou `traceroute6`.
        let mut args = vec![
            "-m".into(), "30".into(),
            "-w".into(), "3".into(),
        ];
        if is_ipv6  { args.push("-6".into()); }
        if !resolve_dns { args.push("-n".into()); }
        args.push(target.to_string());
        ("traceroute".into(), args)
    }
}

// ── Extração de IP de um token ─────────────────────────────────────────────────

fn extract_ip(token: &str) -> Option<String> {
    let t = token.trim_matches(|c| c == '[' || c == ']' || c == '(' || c == ')');

    // IPv4: quatro octetos decimais separados por ponto
    let parts: Vec<&str> = t.split('.').collect();
    if parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok()) {
        return Some(t.to_string());
    }

    // IPv6: pelo menos dois dois-pontos
    if t.contains(':') && t.chars().filter(|&c| c == ':').count() >= 2 {
        return Some(t.to_string());
    }

    None
}

fn parse_rtt(s: &str) -> Option<f64> {
    let s = s.trim();
    if s == "*"  { return None; }
    if s == "<1" { return Some(0.5); }  // Windows tracert arredondado
    s.parse::<f64>().ok()
}

fn timeout_hop(hop_num: u32) -> HopData {
    HopData {
        hop:     hop_num,
        ip:      None,
        hostname:None,
        timeout: true,
        rtt:     None,
        rtts:    vec![],
        geo:     None,
    }
}

fn avg_rtt(rtts: &[Option<f64>]) -> Option<f64> {
    let valid: Vec<f64> = rtts.iter().filter_map(|r| *r).collect();
    if valid.is_empty() { return None; }
    Some((valid.iter().sum::<f64>() / valid.len() as f64 * 10.0).round() / 10.0)
}

// ── Parser Windows (tracert) ───────────────────────────────────────────────────
//
// Formato: "  N   RTT ms   RTT ms   RTT ms  hostname [IP]"
//       ou: "  N     *        *        *     Request timed out."
//
// Bug corrigido: o tracert em PT-BR usa múltiplos espaços entre `*` e frase
// "esgotado" em vez de "timed out". Agora tokenizamos antes de verificar.

fn parse_windows_line(line: &str) -> Option<HopData> {
    let trimmed = line.trim();
    let hop_num: u32 = trimmed.split_whitespace().next()?.parse().ok()?;
    let rest = trimmed[hop_num.to_string().len()..].trim();
    if rest.is_empty() { return None; }

    let tokens: Vec<&str> = rest.split_whitespace().collect();

    // Detecta timeout: todos os tokens antes de qualquer texto são `*`,
    // ou linha contém frase de timeout (EN / PT-BR).
    let rest_lower = rest.to_ascii_lowercase();
    let all_stars = tokens.iter().filter(|&&t| t != "ms").take(3).all(|&t| t == "*");
    let has_timeout_phrase = rest_lower.contains("timed out")
        || rest_lower.contains("esgotado")
        || rest_lower.contains("esgotou")
        || rest_lower.contains("timeout");

    if all_stars || has_timeout_phrase {
        return Some(timeout_hop(hop_num));
    }

    let mut rtts: Vec<Option<f64>> = Vec::new();
    let mut ip:       Option<String> = None;
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
            // O valor RTT vem ANTES do token "ms"
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

        // Possível hostname (contém ponto, não é puramente numérico)
        if ip.is_none()
            && hostname.is_none()
            && t.contains('.')
            && !t.chars().all(|c| c.is_ascii_digit() || c == '.')
        {
            hostname = Some(t.to_string());
        }

        i += 1;
    }

    let ip = ip?;
    let rtt = avg_rtt(&rtts);

    Some(HopData {
        hop:      hop_num,
        ip:       Some(ip.clone()),
        hostname: hostname.or_else(|| Some(ip)),
        timeout:  false,
        rtt,
        rtts,
        geo:      None,
    })
}

// ── Parser Unix (traceroute) ───────────────────────────────────────────────────
//
// Formato típico:
//   "N  hostname (IP)  RTT ms  RTT ms  RTT ms"
//   "N  IP  RTT ms  RTT ms  RTT ms"          (com -n)
//   "N  * * *"                                (timeout completo)
//   "N  * (IP) * ms"                          (timeout parcial — conservado)
//
// Bug corrigido: linhas com 1 ou 2 `*` (ex.: "* *") não eram detectadas como
// timeout → o hop era silenciosamente descartado e os números ficavam errados.

fn parse_unix_line(line: &str) -> Option<HopData> {
    let trimmed = line.trim();
    let hop_num: u32 = trimmed.split_whitespace().next()?.parse().ok()?;
    let rest = trimmed[hop_num.to_string().len()..].trim();

    let tokens: Vec<&str> = rest.split_whitespace().collect();
    if tokens.is_empty() { return None; }

    // Timeout completo: todos os tokens são `*`
    if tokens.iter().all(|&t| t == "*") {
        return Some(timeout_hop(hop_num));
    }

    // Extrai IP (pode estar com parênteses ou colchetes)
    let mut ip:       Option<String> = None;
    let mut hostname: Option<String> = None;

    for t in &tokens {
        let stripped = t.trim_matches(|c| c == '(' || c == ')' || c == '[' || c == ']');
        if let Some(extracted) = extract_ip(stripped) {
            ip = Some(extracted);
            break;
        }
    }

    // Extrai hostname (token antes do IP entre parênteses)
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

    // Sem IP → timeout parcial (ex.: `* * *` com algum token não-`*`)
    let ip = match ip {
        Some(v) => v,
        None    => return Some(timeout_hop(hop_num)),
    };

    // RTTs: captura até 3 valores numéricos antes de "ms"
    let rtt_re = regex_lite::Regex::new(r"(\d+\.?\d*)\s*ms").unwrap();
    let rtts: Vec<Option<f64>> = rtt_re
        .captures_iter(rest)
        .take(3)
        .map(|c| c[1].parse::<f64>().ok())
        .collect();

    let rtt = avg_rtt(&rtts);

    Some(HopData {
        hop:      hop_num,
        ip:       Some(ip.clone()),
        hostname: hostname.or_else(|| Some(ip)),
        timeout:  false,
        rtt,
        rtts,
        geo:      None,
    })
}

fn parse_line(line: &str) -> Option<HopData> {
    if cfg!(target_os = "windows") {
        parse_windows_line(line)
    } else {
        parse_unix_line(line)
    }
}

// ── Função principal ───────────────────────────────────────────────────────────
//
// Bug corrigido (stop): a versão original nunca armazenava o child no handle
// ("We can't store the child itself easily after taking stdout"), então `stop()`
// era sempre um no-op.  Agora: pegamos stdout primeiro, depois gravamos o child.
//
// Bug corrigido (UTF-8 Windows PT-BR): `BufReader::lines()` falha no primeiro
// byte não-ASCII do cabeçalho do tracert → 0 hops.  Solução: `read_until(b'\n')`
// + `String::from_utf8_lossy` substitui bytes inválidos por '?' sem falhar.

pub async fn run(app: AppHandle, params: TraceParams, handle: ProcessHandle) {
    let (cmd, args) = build_command(&params.target, params.resolve_dns);

    let mut cmd_builder = Command::new(&cmd);
    cmd_builder
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());

    // No Windows, evita abrir a janela preta do cmd/tracert (CREATE_NO_WINDOW)
    #[cfg(target_os = "windows")]
    cmd_builder.creation_flags(0x08000000);

    let mut child = match cmd_builder.spawn() {
        Ok(c)  => c,
        Err(e) => {
            let _ = app.emit_all(
                "traceroute-error",
                &format!("Falha ao iniciar '{}': {}. Verifique se o traceroute está instalado.", cmd, e),
            );
            return;
        }
    };

    // Toma o stdout ANTES de armazenar o child para que stop() possa matar o processo.
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = app.emit_all("traceroute-error", &"Falha ao capturar stdout");
            return;
        }
    };

    {
        let mut lock = handle.lock().await;
        *lock = Some(child);
    }

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
                    // Sanidade: hop_num deve estar no intervalo válido
                    if hop.hop < 1 || hop.hop > 64 { continue; }

                    if let Some(ref ip) = hop.ip.clone() {
                        hop.geo = Some(fetch_geo(ip).await);

                        if resolve_dns
                            && hop.geo.as_ref().map(|g| !g.is_private).unwrap_or(false)
                        {
                            if let Some(rdns) = reverse_dns(ip).await {
                                // Substitui somente se o hostname ainda é o IP bruto
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

    // Aguarda o processo terminar completamente
    let child_opt = {
        let mut lock = handle.lock().await;
        lock.take()
    };
    if let Some(mut c) = child_opt {
        let _ = c.wait().await;
    }

    let _ = app.emit_all("traceroute-complete", &serde_json::json!({ "code": 0 }));
}

// ── Stop ──────────────────────────────────────────────────────────────────────
//
// Bug corrigido: agora funciona porque `run()` armazena o child no handle.

pub async fn stop(handle: ProcessHandle) {
    let child_opt = {
        let mut lock = handle.lock().await;
        lock.take()
    };
    if let Some(mut c) = child_opt {
        let _ = c.kill().await;
        let _ = c.wait().await;
    }
}
