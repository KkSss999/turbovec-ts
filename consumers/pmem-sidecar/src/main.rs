//! A pmem-owned sidecar example.
//!
//! This is not part of `turbovec-service`. pmem owns the process, the JSON-lines
//! transport, the chunk-id mapping, and the decision to persist or rebuild.
//! The sidecar only exposes the Rust service through a narrow request loop.

use std::io::{BufRead, BufReader, Write};

use serde::Deserialize;
use serde_json::{json, Value};
use turbovec_service::{Config, Durability, IndexKind, SearchResult, Service, ServiceError};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Request {
    Add { ids: Vec<u64>, vectors: Vec<f32> },
    Search { query: Vec<f32>, k: usize },
    Save { path: String },
    Stats,
    Shutdown,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut dim = 384usize;
    let mut bits = 4usize;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--dim" => dim = args.next().ok_or("missing --dim value")?.parse()?,
            "--bits" => bits = args.next().ok_or("missing --bits value")?.parse()?,
            other => return Err(format!("unknown argument {other}").into()),
        }
    }

    let service = Service::new(Config::new(dim, bits, IndexKind::IdMap))?;
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let reader = BufReader::new(stdin.lock());

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(Request::Shutdown) => break,
            Ok(request) => handle(&service, request),
            Err(error) => error_response("ERR_TURBOVEC_INVALID_INPUT", error.to_string()),
        };
        writeln!(stdout, "{}", serde_json::to_string(&response)?)?;
        stdout.flush()?;
    }
    Ok(())
}

fn handle(service: &Service, request: Request) -> Value {
    match request {
        Request::Add { ids, vectors } => match service.add_with_ids(&vectors, &ids) {
            Ok(()) => json!({"ok": true, "len": service.len().unwrap_or(0)}),
            Err(error) => service_error(error),
        },
        Request::Search { query, k } => match service.search(&query, k) {
            Ok(SearchResult::IdMap(result)) => {
                json!({"ok": true, "ids": result.ids, "scores": result.scores, "k": result.k})
            }
            Ok(SearchResult::Dense(_)) => error_response(
                "ERR_TURBOVEC_UNSUPPORTED",
                "sidecar is configured for id-map indexes".to_string(),
            ),
            Err(error) => service_error(error),
        },
        Request::Save { path } => match service.checkpoint(&path, Durability::Durable) {
            Ok(()) => json!({"ok": true, "path": path}),
            Err(error) => service_error(error),
        },
        Request::Stats => match service.stats() {
            Ok(stats) => json!({
                "ok": true,
                "kind": "id_map",
                "dim": stats.dim,
                "bits": stats.bit_width,
                "len": stats.len,
                "serialized_bytes": stats.serialized_bytes,
                "estimated_bytes": stats.estimated_bytes,
            }),
            Err(error) => service_error(error),
        },
        Request::Shutdown => unreachable!(),
    }
}

fn service_error(error: ServiceError) -> Value {
    error_response(error.code().as_str(), error.to_string())
}

fn error_response(code: &str, message: String) -> Value {
    json!({"ok": false, "code": code, "message": message})
}
