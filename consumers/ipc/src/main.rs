//! Minimal consumer-owned Unix-socket IPC example.
//!
//! This is deliberately not part of `turbovec-service`. The wire format is
//! newline-delimited JSON with f32 arrays, which is easy to inspect but not a
//! production protocol. Use framed binary payloads for real workloads.

#[cfg(unix)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::net::UnixListener;

    use serde::{Deserialize, Serialize};
    use turbovec_service::{Config, IndexKind, SearchResult, Service};

    #[derive(Deserialize)]
    struct Request {
        query: Vec<f32>,
        k: usize,
    }

    #[derive(Serialize)]
    struct Response {
        scores: Vec<f32>,
        indices: Vec<usize>,
    }

    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/tmp/turbovec-demo.sock".to_string());
    let _ = std::fs::remove_file(&path);

    let service = Service::new(Config::new(8, 4, IndexKind::Dense))?;
    let mut vectors = Vec::with_capacity(24);
    vectors.extend_from_slice(&[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    vectors.extend_from_slice(&[0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    vectors.extend_from_slice(&[0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    service.add(&vectors)?;

    let listener = UnixListener::bind(&path)?;
    println!("listening on {path}");
    for stream in listener.incoming() {
        let mut stream = stream?;
        let mut reader = BufReader::new(stream.try_clone()?);
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
        writeln!(stream, "{}", serde_json::to_string(&response)?)?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn main() {
    eprintln!("this example uses a Unix domain socket; use a platform transport on Windows");
}
