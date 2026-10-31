//! Service-layer overhead benchmark.
//!
//! Run one implementation per process for the cleanest comparison:
//! ```bash
//! RAYON_NUM_THREADS=4 cargo run --release --example service_bench -- --impl core
//! RAYON_NUM_THREADS=4 cargo run --release --example service_bench -- --impl service
//! ```
//!
//! `--impl both` is useful for a quick check but builds two indexes in one
//! process, so prefer separate processes for published numbers.

use std::time::Instant;

use turbovec_core::TurboQuantIndex;
use turbovec_service::{Config, IndexKind, SearchResult, Service};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Core,
    Service,
    Both,
}

struct Args {
    dim: usize,
    bits: usize,
    n: usize,
    nq: usize,
    k: usize,
    repeats: usize,
    mode: Mode,
}

fn parse_args() -> Args {
    let mut args = Args {
        dim: 768,
        bits: 4,
        n: 20_000,
        nq: 100,
        k: 10,
        repeats: 5,
        mode: Mode::Both,
    };
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        let value = |i: usize| -> String {
            argv.get(i + 1)
                .cloned()
                .unwrap_or_else(|| panic!("missing value for {}", argv[i]))
        };
        match argv[i].as_str() {
            "--dim" => {
                args.dim = value(i).parse().unwrap();
                i += 2;
            }
            "--bits" => {
                args.bits = value(i).parse().unwrap();
                i += 2;
            }
            "--n" => {
                args.n = value(i).parse().unwrap();
                i += 2;
            }
            "--nq" => {
                args.nq = value(i).parse().unwrap();
                i += 2;
            }
            "--k" => {
                args.k = value(i).parse().unwrap();
                i += 2;
            }
            "--repeats" => {
                args.repeats = value(i).parse().unwrap();
                i += 2;
            }
            "--impl" => {
                args.mode = match value(i).as_str() {
                    "core" => Mode::Core,
                    "service" => Mode::Service,
                    "both" => Mode::Both,
                    other => panic!("unknown impl {other}"),
                };
                i += 2;
            }
            other => panic!("unknown argument {other}"),
        }
    }
    args
}

fn synth(count: usize, dim: usize, seed: u64) -> Vec<f32> {
    let mut state = seed | 1;
    let mut values = vec![0.0f32; count * dim];
    for row in values.chunks_mut(dim) {
        for value in row.iter_mut() {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            *value = (state as f64 / u64::MAX as f64) as f32 - 0.5;
        }
        let norm = row.iter().map(|value| value * value).sum::<f32>().sqrt();
        for value in row.iter_mut() {
            *value /= norm;
        }
    }
    values
}

fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

fn main() {
    let args = parse_args();
    let vectors = synth(args.n, args.dim, 0x51ed_2701);
    let queries = synth(args.nq, args.dim, 0x9e37_79b9);

    let mut core = None;
    let mut core_build_ms = None;
    if args.mode != Mode::Service {
        let start = Instant::now();
        let mut index = TurboQuantIndex::new(args.dim, args.bits).unwrap();
        index.add_2d(&vectors, args.dim).unwrap();
        index.prepare();
        core_build_ms = Some(start.elapsed().as_secs_f64() * 1e3);
        core = Some(index);
    }

    let mut service = None;
    let mut service_build_ms = None;
    if args.mode != Mode::Core {
        let start = Instant::now();
        let index = Service::new(Config::new(args.dim, args.bits, IndexKind::Dense)).unwrap();
        index.add(&vectors).unwrap();
        index.prepare().unwrap();
        service_build_ms = Some(start.elapsed().as_secs_f64() * 1e3);
        service = Some(index);
    }

    if let Some(index) = &core {
        let warm = index.search(&queries, args.k);
        std::hint::black_box(&warm);
    }
    if let Some(index) = &service {
        let warm = index.search(&queries, args.k).unwrap();
        std::hint::black_box(&warm);
    }

    let mut core_times = Vec::with_capacity(args.repeats);
    let mut service_times = Vec::with_capacity(args.repeats);
    let mut last_indices = Vec::new();
    for run in 0..args.repeats {
        let service_first = args.mode == Mode::Service || (args.mode == Mode::Both && run % 2 == 1);
        if service_first {
            if let Some(index) = &service {
                let start = Instant::now();
                let result = index.search(&queries, args.k).unwrap();
                service_times.push(start.elapsed().as_secs_f64() * 1e3);
                if let SearchResult::Dense(result) = result {
                    last_indices = result.indices;
                }
            }
            if let Some(index) = &core {
                let start = Instant::now();
                let result = index.search(&queries, args.k);
                std::hint::black_box(&result);
                core_times.push(start.elapsed().as_secs_f64() * 1e3);
            }
        } else {
            if let Some(index) = &core {
                let start = Instant::now();
                let result = index.search(&queries, args.k);
                std::hint::black_box(&result);
                core_times.push(start.elapsed().as_secs_f64() * 1e3);
            }
            if let Some(index) = &service {
                let start = Instant::now();
                let result = index.search(&queries, args.k).unwrap();
                service_times.push(start.elapsed().as_secs_f64() * 1e3);
                if let SearchResult::Dense(result) = result {
                    last_indices = result.indices;
                }
            }
        }
    }

    let threads = std::env::var("RAYON_NUM_THREADS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or_else(|| {
            std::thread::available_parallelism()
                .map(|value| value.get())
                .unwrap_or(1)
        });
    println!(
        "service_bench dim={} bits={} n={} nq={} k={} threads={} impl={:?}",
        args.dim, args.bits, args.n, args.nq, args.k, threads, args.mode
    );
    if let Some(build) = core_build_ms {
        println!("core_build_ms={build:.3}");
    }
    if let Some(build) = service_build_ms {
        println!("service_build_ms={build:.3}");
    }
    if args.mode == Mode::Both {
        println!("build_note=first parallel build includes rayon pool initialization");
    }
    if !core_times.is_empty() {
        let core_ms = median(core_times);
        println!("core_search_ms={core_ms:.3}");
        println!("core_qps={:.3}", args.nq as f64 / (core_ms / 1e3));
    }
    if !service_times.is_empty() {
        let service_ms = median(service_times);
        println!("service_search_ms={service_ms:.3}");
        println!("service_qps={:.3}", args.nq as f64 / (service_ms / 1e3));
        let stats = service.as_ref().unwrap().stats().unwrap();
        println!("serialized_bytes={}", stats.serialized_bytes);
        println!("estimated_bytes={}", stats.estimated_bytes);
        println!("last_indices_len={}", last_indices.len());
    }
}
