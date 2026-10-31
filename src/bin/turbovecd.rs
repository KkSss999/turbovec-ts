//! Rust sidecar for the `turbovec-ts` npm package.
//!
//! It is an implementation detail. The package owns the process, the framed
//! stdio transport, and the lifecycle. Consumers only see the JS API.

use std::io::{Read, Write};

use serde_json::{json, Value};
use turbovec_service::{Config, Durability, IndexKind, SearchResult, Service, ServiceError};

fn main() {
    if let Err(error) = run() {
        eprintln!("turbovecd: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut dim = None;
    let mut bits = 4usize;
    let mut kind = IndexKind::Dense;
    let mut load = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--dim" => dim = Some(args.next().ok_or("missing --dim value")?.parse()?),
            "--bits" => bits = args.next().ok_or("missing --bits value")?.parse()?,
            "--kind" => {
                kind = match args.next().ok_or("missing --kind value")?.as_str() {
                    "dense" => IndexKind::Dense,
                    "id_map" => IndexKind::IdMap,
                    other => return Err(format!("unknown kind {other}").into()),
                }
            }
            "--load" => load = Some(args.next().ok_or("missing --load value")?),
            other => return Err(format!("unknown argument {other}").into()),
        }
    }

    let service = if let Some(path) = load {
        Service::load(kind, path)?
    } else {
        Service::new(Config::new(
            dim.ok_or("--dim is required for a new index")?,
            bits,
            kind,
        ))?
    };

    let mut stdin = std::io::stdin().lock();
    let mut stdout = std::io::stdout().lock();
    write_frame(
        &mut stdout,
        json!({
            "ready": true,
            "dim": service.dim(),
            "bits": service.bit_width(),
            "kind": kind_name(service.kind()),
        }),
        &[],
    )?;
    stdout.flush()?;

    loop {
        let Some((header, payload)) = read_frame(&mut stdin)? else {
            break;
        };
        let id = header.get("id").and_then(Value::as_u64).unwrap_or(0);
        let response = dispatch(&service, id, &header, &payload);
        if let Some((response_header, response_payload)) = response? {
            write_frame(&mut stdout, response_header, &response_payload)?;
            stdout.flush()?;
            if header.get("op").and_then(Value::as_str) == Some("shutdown") {
                break;
            }
        }
    }
    Ok(())
}

fn kind_name(kind: IndexKind) -> &'static str {
    match kind {
        IndexKind::Dense => "dense",
        IndexKind::IdMap => "id_map",
    }
}

type Frame = (Value, Vec<u8>);
type FrameResult = Result<Option<Frame>, Box<dyn std::error::Error>>;

fn dispatch(service: &Service, id: u64, header: &Value, payload: &[u8]) -> FrameResult {
    let op = header.get("op").and_then(Value::as_str).unwrap_or("");
    match op {
        "add" => {
            let rows = header.get("rows").and_then(Value::as_u64).unwrap_or(0) as usize;
            let dim = service.dim();
            if payload.len() != rows * dim * 4 {
                return Ok(Some(error_frame(
                    id,
                    "ERR_TURBOVEC_INVALID_INPUT",
                    "vector payload length mismatch",
                )));
            }
            let vectors = f32s(payload);
            match service.add(&vectors) {
                Ok(()) => Ok(Some(ok_frame(
                    id,
                    json!({"len": service.len()?}),
                    Vec::new(),
                ))),
                Err(error) => Ok(Some(service_error_frame(id, error))),
            }
        }
        "add_with_ids" => {
            let rows = header.get("rows").and_then(Value::as_u64).unwrap_or(0) as usize;
            let dim = service.dim();
            let vector_bytes = rows * dim * 4;
            if payload.len() != vector_bytes + rows * 8 {
                return Ok(Some(error_frame(
                    id,
                    "ERR_TURBOVEC_INVALID_INPUT",
                    "id payload length mismatch",
                )));
            }
            let vectors = f32s(&payload[..vector_bytes]);
            let ids = u64s(&payload[vector_bytes..]);
            match service.add_with_ids(&vectors, &ids) {
                Ok(()) => Ok(Some(ok_frame(
                    id,
                    json!({"len": service.len()?}),
                    Vec::new(),
                ))),
                Err(error) => Ok(Some(service_error_frame(id, error))),
            }
        }
        "search" => {
            let dim = service.dim();
            let nq = header.get("nq").and_then(Value::as_u64).unwrap_or(0) as usize;
            let k = header.get("k").and_then(Value::as_u64).unwrap_or(0) as usize;
            let query_bytes = nq * dim * 4;
            if payload.len() < query_bytes {
                return Ok(Some(error_frame(
                    id,
                    "ERR_TURBOVEC_INVALID_INPUT",
                    "query payload length mismatch",
                )));
            }
            let queries = f32s(&payload[..query_bytes]);
            let extra = &payload[query_bytes..];
            let result = match service.kind() {
                IndexKind::Dense => {
                    if extra.is_empty() {
                        service.search(&queries, k)
                    } else {
                        let mask: Vec<bool> = extra.iter().map(|value| *value != 0).collect();
                        service.search_with_mask(&queries, k, &mask)
                    }
                }
                IndexKind::IdMap => {
                    if extra.is_empty() {
                        service.search(&queries, k)
                    } else {
                        service.search_with_allowlist(&queries, k, &u64s(extra))
                    }
                }
            };
            match result {
                Ok(SearchResult::Dense(result)) => {
                    let mut response =
                        Vec::with_capacity(result.scores.len() * 4 + result.indices.len() * 4);
                    for score in &result.scores {
                        response.extend_from_slice(&score.to_le_bytes());
                    }
                    for index in &result.indices {
                        response.extend_from_slice(&(*index as u32).to_le_bytes());
                    }
                    Ok(Some(ok_frame(
                        id,
                        json!({"nq": result.nq, "k": result.k, "kind": "dense"}),
                        response,
                    )))
                }
                Ok(SearchResult::IdMap(result)) => {
                    let mut response =
                        Vec::with_capacity(result.scores.len() * 4 + result.ids.len() * 8);
                    for score in &result.scores {
                        response.extend_from_slice(&score.to_le_bytes());
                    }
                    for id in &result.ids {
                        response.extend_from_slice(&id.to_le_bytes());
                    }
                    Ok(Some(ok_frame(
                        id,
                        json!({"nq": result.nq, "k": result.k, "kind": "id_map"}),
                        response,
                    )))
                }
                Err(error) => Ok(Some(service_error_frame(id, error))),
            }
        }
        "swap_remove" => {
            let slot = header.get("slot").and_then(Value::as_u64).unwrap_or(0) as usize;
            match service.swap_remove(slot) {
                Ok(moved) => Ok(Some(ok_frame(id, json!({"moved": moved}), Vec::new()))),
                Err(error) => Ok(Some(service_error_frame(id, error))),
            }
        }
        "remove" => {
            let item = header_u64(header, "item");
            match service.remove(item) {
                Ok(removed) => Ok(Some(ok_frame(id, json!({"removed": removed}), Vec::new()))),
                Err(error) => Ok(Some(service_error_frame(id, error))),
            }
        }
        "contains" => {
            let item = header_u64(header, "item");
            match service.contains(item) {
                Ok(contains) => Ok(Some(ok_frame(
                    id,
                    json!({"contains": contains}),
                    Vec::new(),
                ))),
                Err(error) => Ok(Some(service_error_frame(id, error))),
            }
        }
        "iter_ids" => match service.iter_ids() {
            Ok(ids) => {
                let mut response = Vec::with_capacity(ids.len() * 8);
                for id in ids {
                    response.extend_from_slice(&id.to_le_bytes());
                }
                Ok(Some(ok_frame(
                    id,
                    json!({"count": response.len() / 8}),
                    response,
                )))
            }
            Err(error) => Ok(Some(service_error_frame(id, error))),
        },
        "checkpoint" | "write" => {
            let path = header.get("path").and_then(Value::as_str).unwrap_or("");
            let durable = header
                .get("durable")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let durability = if durable {
                Durability::Durable
            } else {
                Durability::Fast
            };
            match service.checkpoint(path, durability) {
                Ok(()) => Ok(Some(ok_frame(id, json!({}), Vec::new()))),
                Err(error) => Ok(Some(service_error_frame(id, error))),
            }
        }
        "sync" => {
            let path = header.get("path").and_then(Value::as_str).unwrap_or("");
            match service.sync(path) {
                Ok(()) => Ok(Some(ok_frame(id, json!({}), Vec::new()))),
                Err(error) => Ok(Some(service_error_frame(id, error))),
            }
        }
        "calibrate" => {
            let dim = service.dim();
            if !payload.len().is_multiple_of(dim * 4) {
                return Ok(Some(error_frame(
                    id,
                    "ERR_TURBOVEC_INVALID_INPUT",
                    "calibration payload length mismatch",
                )));
            }
            match service.calibrate(&f32s(payload)) {
                Ok(()) => Ok(Some(ok_frame(id, json!({}), Vec::new()))),
                Err(error) => Ok(Some(service_error_frame(id, error))),
            }
        }
        "prepare" => match service.prepare() {
            Ok(()) => Ok(Some(ok_frame(id, json!({}), Vec::new()))),
            Err(error) => Ok(Some(service_error_frame(id, error))),
        },
        "stats" => match service.stats() {
            Ok(stats) => Ok(Some(ok_frame(
                id,
                json!({
                    "kind": kind_name(stats.kind),
                    "dim": stats.dim,
                    "bits": stats.bit_width,
                    "len": stats.len,
                    "serialized_bytes": stats.serialized_bytes,
                    "estimated_bytes": stats.estimated_bytes,
                }),
                Vec::new(),
            ))),
            Err(error) => Ok(Some(service_error_frame(id, error))),
        },
        "shutdown" => Ok(Some(ok_frame(id, json!({}), Vec::new()))),
        other => Ok(Some(error_frame(
            id,
            "ERR_TURBOVEC_INVALID_INPUT",
            format!("unknown op {other}"),
        ))),
    }
}

fn header_u64(header: &Value, key: &str) -> u64 {
    header
        .get(key)
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        })
        .unwrap_or(0)
}

fn f32s(bytes: &[u8]) -> Vec<f32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect()
}

fn u64s(bytes: &[u8]) -> Vec<u64> {
    bytes
        .as_chunks::<8>()
        .0
        .iter()
        .map(|chunk| u64::from_le_bytes(*chunk))
        .collect()
}

fn read_frame(reader: &mut impl Read) -> FrameResult {
    let mut len = [0u8; 4];
    match reader.read_exact(&mut len) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    let header_len = u32::from_le_bytes(len) as usize;
    if header_len > 1 << 20 {
        return Err("frame header too large".into());
    }
    let mut header_bytes = vec![0u8; header_len];
    reader.read_exact(&mut header_bytes)?;
    let header: Value = serde_json::from_slice(&header_bytes)?;
    let payload_len = header.get("payload").and_then(Value::as_u64).unwrap_or(0) as usize;
    if payload_len > 1 << 30 {
        return Err("frame payload too large".into());
    }
    let mut payload = vec![0u8; payload_len];
    reader.read_exact(&mut payload)?;
    Ok(Some((header, payload)))
}

fn write_frame(writer: &mut impl Write, mut header: Value, payload: &[u8]) -> std::io::Result<()> {
    if let Value::Object(map) = &mut header {
        map.insert("payload".to_string(), Value::from(payload.len() as u64));
    }
    let bytes = serde_json::to_vec(&header)?;
    writer.write_all(&(bytes.len() as u32).to_le_bytes())?;
    writer.write_all(&bytes)?;
    writer.write_all(payload)?;
    Ok(())
}

fn ok_frame(id: u64, mut header: Value, payload: Vec<u8>) -> (Value, Vec<u8>) {
    if let Value::Object(map) = &mut header {
        map.insert("id".to_string(), Value::from(id));
        map.insert("ok".to_string(), Value::from(true));
    }
    (header, payload)
}

fn error_frame(id: u64, code: &str, message: impl ToString) -> (Value, Vec<u8>) {
    (
        json!({"id": id, "ok": false, "code": code, "message": message.to_string()}),
        Vec::new(),
    )
}

fn service_error_frame(id: u64, error: ServiceError) -> (Value, Vec<u8>) {
    error_frame(id, error.code().as_str(), error.to_string())
}
