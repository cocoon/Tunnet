//! Label parsing helpers for enroll bootstrap.

use std::collections::HashMap;

use anyhow::Context;

pub fn parse_label_csv(raw: &str) -> anyhow::Result<HashMap<String, String>> {
    let mut labels = HashMap::new();
    for part in raw.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (key, value) = part
            .split_once('=')
            .with_context(|| format!("invalid label pair: {part}"))?;
        if key.trim().is_empty() {
            anyhow::bail!("label key cannot be empty");
        }
        labels.insert(key.trim().to_string(), value.trim().to_string());
    }
    Ok(labels)
}

pub fn parse_labels_json(raw: &str) -> anyhow::Result<HashMap<String, String>> {
    let value: serde_json::Value = serde_json::from_str(raw).context("invalid labels JSON")?;
    let obj = value.as_object().context("labels JSON must be an object")?;
    let mut labels = HashMap::new();
    for (k, v) in obj {
        let s = v
            .as_str()
            .with_context(|| format!("label {k} must be a string"))?;
        labels.insert(k.clone(), s.to_string());
    }
    Ok(labels)
}
