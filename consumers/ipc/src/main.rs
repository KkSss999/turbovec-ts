//! Minimal consumer-owned local-socket IPC example.
//!
//! `interprocess` maps this to a Unix domain socket on Unix and a named pipe on
//! Windows. The wire format is newline-delimited JSON with f32 arrays, which is
//! easy to inspect but not a production protocol. Use framed binary payloads
//! for real workloads.

use std::io::{BufRead, BufReader, Write};

use interprocess::local_socket::prelude::*;
use interprocess::local_socket::{GenericNamespaced, ListenerOptions, Stream};
use serde::{Deserialize, Serialize};
use turbovec_service::{Config, IndexKind, SearchResult, Service};

const NAME: &str = "turbovec-demo.sock";

#[derive(Deserialize, Serialize)]
struct Request {
    query: Vec<f32>,
    k: usize,
}

#[derive(Serialize)]
struct Response {
    scores: Vec<f32>,
    indices: Vec<usize>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mode = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "server".to_string());
    match mode.as_str() {
        "server" => server(),
        "client" => client(),
        other => Err(format!("unknown mode {other}; use server or client").into()),
    }
}

fn server() -> Result<(), Box<dyn std::error::Error>> {
    let service = Service::new(Config::new(8, 4, IndexKind::Dense))?;
    let mut vectors = Vec::with_capacity(24);
    vectors.extend_from_slice(&[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    vectors.extend_from_slice(&[0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    vectors.extend_from_slice(&[0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    service.add(&vectors)?;

    let name = NAME.to_ns_name::<GenericNamespaced>()?;
    let listener = ListenerOptions::new().name(name).create_sync()?;
    println!("listening on {NAME}");
    for conn in listener.incoming().filter_map(Result::ok) {
        let mut reader = BufReader::new(conn);
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            continue;
        }
        let request: Request = serde_json::from_str(line.trim())?;
        let response = match service.search(&request.query, request.k)? {
            SearchResult::Dense(result) => Response {
                scores: result.scores,
                indices: result
                    .indices
                    .into_iter()
                    .map(|index| index as usize)
                    .collect(),
            },
            SearchResult::IdMap(_) => unreachable!(),
        };
        writeln!(reader.get_mut(), "{}", serde_json::to_string(&response)?)?;
    }
    Ok(())
}

fn client() -> Result<(), Box<dyn std::error::Error>> {
    let name = NAME.to_ns_name::<GenericNamespaced>()?;
    let mut conn = Stream::connect(name)?;
    let request = serde_json::to_string(&Request {
        query: vec![1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        k: 2,
    })?;
    writeln!(conn, "{request}")?;
    let mut reader = BufReader::new(conn);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    print!("{line}");
    Ok(())
}
