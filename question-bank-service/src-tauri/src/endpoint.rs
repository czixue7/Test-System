use serde::Serialize;
use serde_json::Value;
use std::time::{Duration, Instant};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub success: bool,
    pub reachable: bool,
    pub base_url: String,
    pub checked_url: String,
    pub latency_ms: u128,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_url: Option<String>,
}

pub fn migrate_legacy_endpoint(config: &mut crate::model::Config) -> Result<bool, String> {
    let Some(port) = config.public_port else { return Ok(false) };
    if !config.public_url.trim().is_empty() {
        config.public_url = normalize_url(&config.public_url, Some(port))?;
    }
    config.public_port = None;
    Ok(true)
}

pub fn normalize_url(input: &str, port: Option<u16>) -> Result<String, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("请填写第三方提供的访问链接".into());
    }
    let value = if input.contains("://") {
        input.to_owned()
    } else {
        format!("http://{input}")
    };
    let mut url =
        reqwest::Url::parse(&value).map_err(|_| "链接格式无效，请填写 HTTP/HTTPS 地址")?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("请填写 HTTP/HTTPS 服务地址，不包含账号、查询参数或片段".into());
    }
    if port == Some(0) || url.port() == Some(0) {
        return Err("端口必须在 1 到 65535 之间".into());
    }
    if let Some(port) = port {
        url.set_port(Some(port)).map_err(|_| "端口无效")?;
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

pub async fn probe(input: &str, port: Option<u16>, token: &str) -> Result<TestResult, String> {
    probe_with_timeout(input, port, token, Duration::from_secs(8)).await
}
async fn probe_with_timeout(
    input: &str,
    port: Option<u16>,
    token: &str,
    timeout: Duration,
) -> Result<TestResult, String> {
    let base_url = normalize_url(input, port)?;
    let checked_url = format!("{base_url}/api/v1/health");
    let mut suggested_url = None;
    let begin = Instant::now();
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(timeout.min(Duration::from_secs(4)))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let result = async {
        let mut response = client
            .get(&checked_url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    "连接超时，请检查链接、端口和第三方 frp 服务".into()
                } else if checked_url.starts_with("https://") && e.is_connect() {
                    format!("HTTPS 连接失败，请检查第三方隧道是否已启用 HTTPS、证书是否有效及本地服务是否运行：{e}")
                } else {
                    format!("连接失败：{e}")
                }
            })?;
        let status = response.status();
        let sakura = response.headers().get(reqwest::header::SERVER)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.eq_ignore_ascii_case("SakuraFrp"));
        if !status.is_success() {
            let message = match status.as_u16() {
                501 if sakura && base_url.starts_with("http://") => {
                    suggested_url = Some(base_url.replacen("http://", "https://", 1));
                    "第三方 SakuraFrp 节点拦截了明文 HTTP（HTTP 501），尚未连到题库服务。请在第三方 frp 为此隧道启用自动 HTTPS 并配置有效证书，重启隧道后使用 HTTPS 地址测试。".into()
                }
                501 => "响应端未实现该请求（HTTP 501），请检查第三方隧道的协议和本地转发目标是否指向题库服务。".into(),
                401 | 403 => format!("地址可连接，但访问密钥无效或权限不足（HTTP {status}）"),
                300..=399 => {
                    format!("地址可连接，但返回重定向（HTTP {status}），请填写最终服务链接")
                }
                404 => "地址可连接，但找不到题库服务接口（HTTP 404），请检查链接路径".into(),
                _ => format!("地址可连接，但服务器返回错误（HTTP {status}）"),
            };
            return Ok::<_, String>((false, true, message));
        }
        let mut bytes = Vec::new();
        loop {
            let chunk = match response.chunk().await {
                Ok(chunk) => chunk,
                Err(e) => {
                    return Ok((
                        false,
                        true,
                        if e.is_timeout() {
                            "读取服务响应超时".into()
                        } else {
                            format!("服务响应读取失败：{e}")
                        },
                    ))
                }
            };
            let Some(chunk) = chunk else {
                break;
            };
            if bytes.len() + chunk.len() > 8192 {
                return Ok((false, true, "地址可连接，但响应超过健康检查大小限制".into()));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = match serde_json::from_slice(&bytes) {
            Ok(v) => v,
            Err(_) => {
                return Ok((
                    false,
                    true,
                    "地址可连接，但返回的内容不是题库服务 JSON".into(),
                ))
            }
        };
        if value["service"] != "question-bank-service" || value["version"].as_u64() != Some(1) {
            return Ok((false, true, "地址可连接，但不是兼容的题库服务台".into()));
        }
        Ok((true, true, "连接成功，题库服务和访问密钥均有效".into()))
    }
    .await;
    let (success, reachable, message) = match result {
        Ok(value) => value,
        Err(message) => (false, false, message),
    };
    Ok(TestResult {
        success,
        reachable,
        base_url,
        checked_url,
        latency_ms: begin.elapsed().as_millis(),
        message,
        suggested_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    #[test]
    fn normalizes_links_ports_and_legacy_config() {
        assert_eq!(normalize_url("frp-sea.com:65079", None).unwrap(), "http://frp-sea.com:65079");
        assert_eq!(normalize_url("https://frp-sea.com:65079/prefix/", None).unwrap(), "https://frp-sea.com:65079/prefix");
        assert_eq!(normalize_url("[::1]:18080", None).unwrap(), "http://[::1]:18080");
        assert_eq!(
            normalize_url(" example.test/prefix/ ", Some(12345)).unwrap(),
            "http://example.test:12345/prefix"
        );
        assert_eq!(
            normalize_url("https://example.test:111/prefix", Some(222)).unwrap(),
            "https://example.test:222/prefix"
        );
        assert_eq!(
            normalize_url("http://[::1]", Some(18080)).unwrap(),
            "http://[::1]:18080"
        );
        for value in [
            "",
            "ftp://host",
            "https://a:b@host",
            "https://host?secret=x",
            "https://host/#frag",
            "http://host:0",
            "host:65536",
            "host:not-a-port",
        ] {
            assert!(normalize_url(value, None).is_err(), "{value}");
        }
        assert!(normalize_url("http://host", Some(0)).is_err());
        let config:crate::model::Config=serde_json::from_value(serde_json::json!({"tunnel":{"enabled":true,"protocol":"bad","executable":"old-frpc.exe"}})).unwrap();
        config.validate().unwrap();
        assert!(serde_json::to_value(config)
            .unwrap()
            .get("tunnel")
            .is_none());
    }
    #[test]
    fn migrates_separate_port_once_without_later_overrides() {
        let mut config = crate::model::Config::default();
        config.public_url = "https://example.test:111/prefix".into();
        config.public_port = Some(222);
        assert!(migrate_legacy_endpoint(&mut config).unwrap());
        assert_eq!(config.public_url, "https://example.test:222/prefix");
        assert_eq!(config.public_port, None);
        assert!(!migrate_legacy_endpoint(&mut config).unwrap());
        config.public_url = "frp-sea.com:65079".into();
        assert_eq!(normalize_url(&config.public_url, config.public_port).unwrap(), "http://frp-sea.com:65079");
    }
    #[tokio::test]
    async fn identifies_sakura_http_block_without_reporting_success() {
        for server in ["SakuraFrp", "OtherServer"] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let task = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = [0u8; 4096];
                let n = socket.read(&mut buf).await.unwrap();
                assert!(String::from_utf8_lossy(&buf[..n]).starts_with("GET /prefix/api/v1/health HTTP/1.1"));
                socket.write_all(format!("HTTP/1.1 501 Not Implemented\r\nServer: {server}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
            });
            let result = probe(&format!("{address}/prefix"), None, "test-token").await.unwrap();
            assert!(!result.success);
            assert!(result.reachable);
            if server == "SakuraFrp" {
                assert!(result.message.contains("拦截了明文 HTTP"));
                assert_eq!(result.suggested_url, Some(format!("https://{address}/prefix")));
            } else {
                assert!(result.message.contains("未实现该请求"));
                assert!(result.suggested_url.is_none());
            }
            task.await.unwrap();
        }
    }
    #[tokio::test]
    async fn identifies_service_auth_and_wrong_responses() {
        for (status, body, success) in [
            (
                "200 OK",
                r#"{"service":"question-bank-service","version":1}"#,
                true,
            ),
            ("401 Unauthorized", "{}", false),
            ("404 Not Found", "{}", false),
            ("200 OK", "<html>other site</html>", false),
            ("200 OK", r#"{"service":"other","version":1}"#, false),
            (
                "200 OK",
                r#"{"service":"question-bank-service","version":2}"#,
                false,
            ),
            ("200 OK", "oversize", false),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let body = if body == "oversize" {
                "x".repeat(9000)
            } else {
                body.to_owned()
            };
            let task = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = [0u8; 4096];
                let n = socket.read(&mut buf).await.unwrap();
                assert!(String::from_utf8_lossy(&buf[..n])
                    .to_lowercase()
                    .contains("authorization: bearer test-token"));
                socket.write_all(format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
            });
            let result = probe(&format!("http://{address}"), None, "test-token")
                .await
                .unwrap();
            assert_eq!(result.success, success);
            assert!(result.reachable);
            assert!(result.checked_url.ends_with("/api/v1/health"));
            task.await.unwrap();
        }
    }
    #[tokio::test]
    async fn reports_refusal_timeout_and_does_not_follow_redirects() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        assert!(
            !probe(&format!("http://{address}"), None, "test")
                .await
                .unwrap()
                .reachable
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (_socket, _) = listener.accept().await.unwrap();
            std::future::pending::<()>().await;
        });
        let result = probe_with_timeout(
            &format!("http://{address}"),
            None,
            "test",
            Duration::from_millis(100),
        )
        .await
        .unwrap();
        assert!(!result.success);
        assert!(result.message.contains("超时"));
        task.abort();
        let _ = task.await;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target_address = target.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 4096];
            let _ = socket.read(&mut buf).await;
            socket.write_all(format!("HTTP/1.1 302 Found\r\nLocation: http://{target_address}/\r\nContent-Length: 0\r\n\r\n").as_bytes()).await.unwrap();
        });
        let result = probe(&format!("http://{address}"), None, "test")
            .await
            .unwrap();
        assert!(!result.success);
        assert!(result.message.contains("重定向"));
        assert!(
            tokio::time::timeout(Duration::from_millis(100), target.accept())
                .await
                .is_err()
        );
        task.await.unwrap();
    }
}
