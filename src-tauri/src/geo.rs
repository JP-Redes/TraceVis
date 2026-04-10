//! Geolocalização (ip-api.com) e resolução reversa de DNS.
//!
//! Usa `std::sync::OnceLock` (estável desde Rust 1.70) em vez de lazy_static,
//! e é compatível com a API do reqwest 0.12.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::str::FromStr;
use std::sync::{Mutex, OnceLock};

// ── GeoInfo ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GeoInfo {
    pub ip:           String,
    pub city:         String,
    pub region:       String,
    pub country:      String,
    pub country_code: String,
    pub lat:          Option<f64>,
    pub lon:          Option<f64>,
    pub isp:          String,
    pub org:          String,
    pub asn:          String,
    pub is_private:   bool,
}

// ── Caches (vida do processo) ─────────────────────────────────────────────────

static GEO_CACHE:  OnceLock<Mutex<HashMap<String, GeoInfo>>>          = OnceLock::new();
static RDNS_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>>   = OnceLock::new();

fn geo_cache()  -> &'static Mutex<HashMap<String, GeoInfo>> {
    GEO_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}
fn rdns_cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    RDNS_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

// ── Detecção de IP privado ────────────────────────────────────────────────────

pub fn is_private_ip(ip: &str) -> bool {
    if ip.is_empty() { return true; }
    match IpAddr::from_str(ip) {
        Ok(IpAddr::V4(a)) => {
            a.is_loopback()
                || a.is_private()
                || a.is_link_local()
                // CGNAT 100.64.0.0/10
                || (a.octets()[0] == 100 && (a.octets()[1] & 0xC0) == 64)
        }
        Ok(IpAddr::V6(a)) => {
            a.is_loopback()
                || a.is_unspecified()
                || (a.segments()[0] & 0xFFC0) == 0xFE80 // link-local
                || (a.segments()[0] & 0xFE00) == 0xFC00 // unique-local
        }
        Err(_) => true, // não parseável → trata como privado
    }
}

// ── GeoIP ─────────────────────────────────────────────────────────────────────

pub async fn fetch_geo(ip: &str) -> GeoInfo {
    // Verifica cache
    if let Some(cached) = geo_cache().lock().unwrap().get(ip).cloned() {
        return cached;
    }

    // IP privado → sem consulta
    if is_private_ip(ip) {
        let result = GeoInfo {
            ip:         ip.to_string(),
            city:       "Local Network".into(),
            country:    "Private".into(),
            is_private: true,
            ..Default::default()
        };
        geo_cache().lock().unwrap().insert(ip.to_string(), result.clone());
        return result;
    }

    // ip-api.com (gratuito, sem API key)
    let url = format!(
        "http://ip-api.com/json/{}?fields=status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,query",
        ip
    );

    let result = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Err(_) => GeoInfo { ip: ip.to_string(), country: "Unknown".into(), ..Default::default() },
        Ok(client) => match client.get(&url).send().await {
            Err(_) => GeoInfo { ip: ip.to_string(), country: "Unknown".into(), ..Default::default() },
            Ok(resp) => match resp.json::<serde_json::Value>().await {
                Ok(data) if data["status"] == "success" => {
                    let asn_raw = data["as"].as_str().unwrap_or("").to_string();
                    let asn = asn_raw.split_whitespace().next().unwrap_or("").to_string();
                    GeoInfo {
                        ip:           data["query"].as_str().unwrap_or(ip).to_string(),
                        city:         data["city"].as_str().unwrap_or("").to_string(),
                        region:       data["regionName"].as_str().unwrap_or("").to_string(),
                        country:      data["country"].as_str().unwrap_or("Unknown").to_string(),
                        country_code: data["countryCode"].as_str().unwrap_or("").to_uppercase(),
                        lat:          data["lat"].as_f64(),
                        lon:          data["lon"].as_f64(),
                        isp:          data["isp"].as_str().unwrap_or("").to_string(),
                        org:          data["org"].as_str().unwrap_or("").to_string(),
                        asn,
                        is_private:   false,
                    }
                }
                _ => GeoInfo { ip: ip.to_string(), country: "Unknown".into(), ..Default::default() },
            },
        },
    };

    geo_cache().lock().unwrap().insert(ip.to_string(), result.clone());
    result
}

// ── Reverse DNS via Cloudflare DoH ────────────────────────────────────────────

pub async fn reverse_dns(ip: &str) -> Option<String> {
    // Verifica cache
    if let Some(cached) = rdns_cache().lock().unwrap().get(ip).cloned() {
        return cached;
    }

    if is_private_ip(ip) {
        rdns_cache().lock().unwrap().insert(ip.to_string(), None);
        return None;
    }

    // Constrói o nome do registro PTR
    let addr = IpAddr::from_str(ip).ok()?;
    let ptr_name = match addr {
        IpAddr::V4(a) => {
            let o = a.octets();
            format!("{}.{}.{}.{}.in-addr.arpa", o[3], o[2], o[1], o[0])
        }
        IpAddr::V6(a) => {
            let nibbles: String = a
                .octets()
                .iter()
                .rev()
                .flat_map(|&b| {
                    [
                        char::from_digit((b & 0xf) as u32, 16).unwrap_or('0'),
                        '.',
                        char::from_digit((b >> 4) as u32, 16).unwrap_or('0'),
                        '.',
                    ]
                })
                .collect();
            format!("{}ip6.arpa", nibbles)
        }
    };

    let url = format!(
        "https://cloudflare-dns.com/dns-query?name={}&type=PTR",
        ptr_name
    );

    let result = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?
        .get(&url)
        .header("accept", "application/dns-json")
        .send()
        .await
        .ok()?
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|data| {
            data["Answer"]
                .as_array()?
                .iter()
                .find(|entry| entry["type"].as_u64() == Some(12)) // 12 = PTR
                .and_then(|entry| entry["data"].as_str())
                .map(|s| s.trim_end_matches('.').to_string())
        });

    rdns_cache().lock().unwrap().insert(ip.to_string(), result.clone());
    result
}
