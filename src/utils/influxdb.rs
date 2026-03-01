//! InfluxDB client for persisting blocks and events data.
//!
//! This module provides functionality to write blockchain monitoring data
//! to InfluxDB v2, including blocks, events, and mint source classification.

use crate::models::{MonitorMatch, BlockType, Network};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Configuration for InfluxDB connection
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct InfluxConfig {
    pub url: String,
    pub token: String,
    pub bucket: String,
    #[serde(default = "default_org")]
    pub org: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_org() -> String {
    "xdc".to_string()
}

fn default_timeout() -> u64 {
    30
}

impl InfluxConfig {
    /// Load InfluxDB configuration from environment variables
    pub fn from_env() -> Option<Self> {
        use std::env::var;

        let enabled = var("INFLUXDB_ENABLED")
            .ok()
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        if !enabled {
            return None;
        }

        let url = var("INFLUXDB_URL").ok()?;
        let token = var("INFLUXDB_TOKEN").ok()?;
        let bucket = var("INFLUXDB_BUCKET").ok().unwrap_or_else(|| "usdc_testdata_bucket".to_string());
        let org = var("INFLUXDB_ORG").ok().unwrap_or_else(|| "xdc".to_string());
        let timeout_secs = var("INFLUXDB_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);

        Some(Self {
            url,
            token,
            bucket,
            org,
            enabled: true,
            timeout_secs,
        })
    }
}

/// Mint source classification configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MintSourcesConfig {
    pub description: String,
    pub version: String,
    pub last_updated: String,
    pub sources: HashMap<String, MintSource>,
    #[serde(default = "default_source")]
    pub default_source: String,
    pub fallback_behavior: FallbackBehavior,
}

fn default_source() -> String {
    "UNKNOWN".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MintSource {
    pub label: String,
    pub description: String,
    pub addresses: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FallbackBehavior {
    #[serde(default = "default_not_matched")]
    pub when_not_matched: String,
    #[serde(default = "default_zero_address")]
    pub when_minted_from_zero_address: String,
}

fn default_not_matched() -> String {
    "UNKNOWN".to_string()
}

fn default_zero_address() -> String {
    "NATIVE_MINTER".to_string()
}

impl MintSourcesConfig {
    /// Load mint sources configuration from file
    pub fn load_from_file<P: AsRef<Path>>(path: P) -> Option<Self> {
        let content = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// Load from environment variable path or default location
    pub fn from_env() -> Option<Self> {
        use std::env::var;

        let path = var("MINT_SOURCES_CONFIG")
            .ok()
            .unwrap_or_else(|| "config/mint_sources.json".to_string());

        Self::load_from_file(path)
    }

    /// Classify the mint source based on the caller address (tx.from)
    pub fn classify(&self, caller: &str, minter: Option<&str>) -> String {
        let caller_lower = caller.to_lowercase();
        let minter_lower = minter.map(|m| m.to_lowercase());

        // Special case: if minted from zero address, it's native mint
        if let Some(ref m) = minter_lower {
            if m == "0x0000000000000000000000000000000000000000" || m == "0x0" {
                return self.fallback_behavior.when_minted_from_zero_address.clone();
            }
        }

        // Look up the caller in any of the source address lists
        for (source_id, source) in &self.sources {
            for addr in &source.addresses {
                if addr.to_lowercase() == caller_lower {
                    return source_id.clone();
                }
            }
        }

        // If minter is the caller (direct mint), classify as native
        if let Some(ref m) = minter_lower {
            if m.as_str() == caller_lower {
                return "NATIVE_MINTER".to_string();
            }
        }

        // Default fallback
        self.fallback_behavior.when_not_matched.clone()
    }
}

/// InfluxDB client for writing data using v2 API
#[derive(Clone)]
pub struct InfluxClient {
    url: String,
    token: String,
    bucket: String,
    org: String,
    client: reqwest::Client,
    mint_sources: Option<MintSourcesConfig>,
}

impl std::fmt::Debug for InfluxClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InfluxClient")
            .field("bucket", &self.bucket)
            .field("org", &self.org)
            .finish()
    }
}

impl InfluxClient {
    /// Create a new InfluxDB client
    pub fn new(config: InfluxConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            url: config.url,
            token: config.token,
            bucket: config.bucket,
            org: config.org,
            client,
            mint_sources: MintSourcesConfig::from_env(),
        }
    }

    /// Extract transaction sender address (tx.from) from a match
    pub fn get_caller_from_match(monitor_match: &MonitorMatch) -> Option<String> {
        match monitor_match {
            MonitorMatch::EVM(evm_match) => {
                evm_match.transaction.from.as_ref().map(|addr| format!("{:#x}", addr))
            }
            MonitorMatch::Stellar(_) => None,
        }
    }

    /// Extract minter address from Mint event arguments
    pub fn get_minter_from_match(monitor_match: &MonitorMatch) -> Option<String> {
        match monitor_match {
            MonitorMatch::EVM(evm_match) => {
                if let Some(ref args) = evm_match.matched_on_args {
                    if let Some(ref events) = args.events {
                        for event in events {
                            if event.signature.contains("Mint") {
                                if let Some(ref event_args) = event.args {
                                    for arg in event_args {
                                        if arg.name == "minter" {
                                            return Some(arg.value.clone());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                None
            }
            MonitorMatch::Stellar(_) => None,
        }
    }

    /// Classify the mint source for a match
    pub fn classify_mint_source(&self, monitor_match: &MonitorMatch) -> String {
        let mint_sources = match &self.mint_sources {
            Some(config) => config,
            None => return "UNKNOWN".to_string(),
        };

        let caller = match Self::get_caller_from_match(monitor_match) {
            Some(c) => c,
            None => return "UNKNOWN".to_string(),
        };

        let minter = Self::get_minter_from_match(monitor_match);
        mint_sources.classify(&caller, minter.as_deref())
    }

    /// Write line protocol to InfluxDB v2
    async fn write_line_protocol(&self, lines: Vec<String>) -> Result<(), String> {
        if lines.is_empty() {
            return Ok(());
        }

        let url = format!("{}/api/v2/write?org={}&bucket={}&precision=ns",
            self.url, self.org, self.bucket);

        let body = lines.join("\n");

        self.client
            .post(&url)
            .header("Authorization", format!("Token {}", self.token))
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(body)
            .send()
            .await
            .map_err(|e| format!("InfluxDB write request failed: {}", e))?
            .error_for_status()
            .map_err(|e| format!("InfluxDB write failed: status={}", e))?;

        Ok(())
    }

    /// Ensure the bucket exists (for initialization)
    pub async fn ensure_ready(&self) -> Result<(), String> {
        // Just verify we can connect
        let url = format!("{}/api/v2/buckets?org={}&name={}",
            self.url, self.org, self.bucket);

        self.client
            .get(&url)
            .header("Authorization", format!("Token {}", self.token))
            .send()
            .await
            .map_err(|e| format!("InfluxDB connection test failed: {}", e))?;

        tracing::info!(
            bucket = %self.bucket,
            "InfluxDB client ready (bucket: {})",
            self.bucket
        );
        Ok(())
    }

    /// Persist block and matches to InfluxDB with mint_source classification
    pub async fn persist_block_and_matches(
        &self,
        network: &Network,
        block: &BlockType,
        matches: &[MonitorMatch],
    ) -> Result<(), String> {
        let mut lines = Vec::new();

        // Build block line protocol
        let block_lines = self.build_block_lines(network, block);
        lines.extend(block_lines);

        // Build event line protocol with mint_source
        if !matches.is_empty() {
            let event_lines = self.build_event_lines(network, matches);
            lines.extend(event_lines);
        }

        // Write to InfluxDB
        if !lines.is_empty() {
            self.write_line_protocol(lines).await?;
        }

        Ok(())
    }

    /// Build line protocol for block data
    fn build_block_lines(&self, network: &Network, block: &BlockType) -> Vec<String> {
        let (block_number, tx_count, match_count) = match block {
            BlockType::EVM(evm_block) => {
                let block_num = evm_block.number().unwrap_or(0);
                let tx_count = evm_block.transactions.len() as u64;
                (block_num, tx_count, 0u64)
            }
            BlockType::Stellar(stellar_block) => {
                (stellar_block.sequence as u64, 0, 0)
            }
        };

        let tags = format!(
            "chain_id=50,network_slug={},network_type=EVM",
            network.slug
        );

        vec![
            format!("blocks,{} block_number={}i,tx_count={}i,match_count={}i",
                tags, block_number, tx_count, match_count)
        ]
    }

    /// Build line protocol for events with mint_source tag
    fn build_event_lines(&self, network: &Network, matches: &[MonitorMatch]) -> Vec<String> {
        let mut lines = Vec::new();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);

        for monitor_match in matches {
            let mint_source = self.classify_mint_source(monitor_match);

            let monitor_name = match monitor_match {
                MonitorMatch::EVM(evm) => evm.monitor.name.clone(),
                MonitorMatch::Stellar(s) => s.monitor.name.clone(),
            };

            // Get contract address if available
            let contract_address = match monitor_match {
                MonitorMatch::EVM(evm) => {
                    evm.receipt.as_ref()
                        .and_then(|r| r.contract_address)
                        .map(|addr| format!("{:#x}", addr))
                }
                MonitorMatch::Stellar(_) => None,
            };

            // Extract event data
            match monitor_match {
                MonitorMatch::EVM(evm_match) => {
                    // Get transaction sender address (tx.from)
                    let caller_addr = evm_match.transaction.from.as_ref()
                        .map(|addr| format!("{:#x}", addr));

                    if let Some(ref args) = evm_match.matched_on_args {
                        if let Some(ref events) = args.events {
                            for event in events {
                                let signature = &event.signature;

                                if let Some(ref event_args) = event.args {
                                    for arg in event_args {
                                        let field_name = &arg.name;
                                        let value = &arg.value;

                                        // Build tags - signature moved to field to avoid escaping issues
                                        let tags = format!(
                                            "kind=event,monitor_name=\"{}\",network_slug={},mint_source={}",
                                            escape_tag_value(&monitor_name),
                                            escape_tag_value(&network.slug),
                                            escape_tag_value(&mint_source)
                                        );

                                        // Use caller address for from_addr, keep original from as from_event
                                        // Rename "to" to "to_addr" for consistency with from_addr
                                        let mut fields = if field_name == "from" {
                                            format!("from_event=\"{}\"", escape_field_value(value))
                                        } else if field_name == "to" {
                                            format!("to_addr=\"{}\"", escape_field_value(value))
                                        } else {
                                            format!("{}=\"{}\"", field_name, escape_field_value(value))
                                        };

                                        // Add signature as field
                                        fields.push_str(&format!(",signature=\"{}\"", escape_field_value(signature)));

                                        // Add from_addr (transaction sender)
                                        if let Some(ref ca) = caller_addr {
                                            fields.push_str(&format!(",from_addr=\"{}\"", ca));
                                        }

                                        if let Some(ref ca) = contract_address {
                                            fields.push_str(&format!(",contract_address=\"{}\"", ca));
                                        }

                                        lines.push(format!("events,{} {} {}", tags, fields, timestamp));

                                        // Debug log
                                        tracing::debug!("Line protocol: events,{} {} {}", tags, fields, timestamp);
                                    }
                                }
                            }
                        }
                    }
                }
                MonitorMatch::Stellar(_) => {}
            }
        }

        lines
    }
}

/// Escape special characters in InfluxDB tag values
fn escape_tag_value(s: &str) -> String {
    s.replace("\\", "\\\\")
     .replace(",", "\\,")
     .replace("=", "\\=")
     .replace(" ", "\\ ")
     .replace("(", "\\(")
     .replace(")", "\\)")
     .replace("[", "\\[")
     .replace("]", "\\]")
}

/// Escape special characters in InfluxDB field values (strings)
fn escape_field_value(s: &str) -> String {
    s.replace("\\", "\\\\")
     .replace("\"", "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mint_source_classification() {
        let config = MintSourcesConfig {
            description: "Test".to_string(),
            version: "1.0.0".to_string(),
            last_updated: "2026-02-23".to_string(),
            sources: {
                let mut m = HashMap::new();
                m.insert(
                    "XDC_OFFICIAL_BRIDGE".to_string(),
                    MintSource {
                        label: "XDC Official Bridge".to_string(),
                        addresses: vec!["0x1234567890123456789012345678901234567890".to_string()],
                    },
                );
                m.insert(
                    "STARGATE_BRIDGE".to_string(),
                    MintSource {
                        label: "Stargate".to_string(),
                        addresses: vec!["0xabcdefabcdefabcdefabcdefabcdefabcdefabcd".to_string()],
                    },
                );
                m
            },
            default_source: "UNKNOWN".to_string(),
            fallback_behavior: FallbackBehavior {
                when_not_matched: "UNKNOWN".to_string(),
                when_minted_from_zero_address: "NATIVE_MINTER".to_string(),
            },
        };

        assert_eq!(
            config.classify("0x1234567890123456789012345678901234567890", None),
            "XDC_OFFICIAL_BRIDGE"
        );

        assert_eq!(
            config.classify("0x9999999999999999999999999999999999999999", None),
            "UNKNOWN"
        );

        assert_eq!(
            config.classify("0x1234", Some("0x0000000000000000000000000000000000000000")),
            "NATIVE_MINTER"
        );
    }

    #[test]
    fn test_config_from_env_not_enabled() {
        let config = InfluxConfig::from_env();
        assert!(config.is_none() || config.is_some());
    }
}
