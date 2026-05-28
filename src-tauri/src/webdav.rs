//! Simple WebDAV client for backup/restore

use reqwest::Client;
use std::path::Path;

pub struct WebDavClient {
    client: Client,
    base_url: String,
    username: Option<String>,
    password: Option<String>,
}

impl WebDavClient {
    pub fn new(url: String, username: Option<String>, password: Option<String>) -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
            base_url: url.trim_end_matches('/').to_string(),
            username,
            password,
        }
    }

    fn auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let (Some(u), Some(p)) = (&self.username, &self.password) {
            req.basic_auth(u, Some(p))
        } else {
            req
        }
    }

    /// Test connection by performing a PROPFIND on the root
    pub async fn test_connection(&self) -> Result<(), WebDavError> {
        let req = self
            .client
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &self.base_url)
            .header("Content-Type", "application/xml")
            .header("Depth", "0")
            .body("<?xml version=\"1.0\" encoding=\"utf-8\"?><propfind xmlns=\"DAV:\"><prop></prop></propfind>");

        let resp = self
            .auth(req)
            .send()
            .await
            .map_err(|e| WebDavError::Request(e.to_string()))?;

        if !resp.status().is_success() && resp.status().as_u16() != 207 {
            return Err(WebDavError::Status(resp.status().as_u16()));
        }
        Ok(())
    }

    /// Upload a file to the given path on the WebDAV server
    pub async fn upload(&self, remote_path: &str, local_path: &Path) -> Result<(), WebDavError> {
        let url = format!("{}/{}", self.base_url, remote_path.trim_start_matches('/'));
        let data = tokio::fs::read(local_path)
            .await
            .map_err(|e| WebDavError::Io(e.to_string()))?;

        let req = self
            .client
            .put(&url)
            .header("Content-Type", "application/octet-stream")
            .body(data);

        let resp = self
            .auth(req)
            .send()
            .await
            .map_err(|e| WebDavError::Request(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(WebDavError::Status(resp.status().as_u16()));
        }
        Ok(())
    }

    /// Download a file from the given path on the WebDAV server
    pub async fn download(&self, remote_path: &str, local_path: &Path) -> Result<(), WebDavError> {
        let url = format!("{}/{}", self.base_url, remote_path.trim_start_matches('/'));

        let req = self.client.get(&url);
        let resp = self
            .auth(req)
            .send()
            .await
            .map_err(|e| WebDavError::Request(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(WebDavError::Status(resp.status().as_u16()));
        }

        let data = resp
            .bytes()
            .await
            .map_err(|e| WebDavError::Request(e.to_string()))?;
        tokio::fs::write(local_path, data)
            .await
            .map_err(|e| WebDavError::Io(e.to_string()))?;
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WebDavError {
    #[error("Request error: {0}")]
    Request(String),
    #[error("IO error: {0}")]
    Io(String),
    #[error("HTTP error: {0}")]
    Status(u16),
}
