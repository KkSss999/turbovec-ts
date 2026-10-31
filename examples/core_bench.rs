//! Direct-core baseline for the B1 sidecar benchmark.
//!
//! It reads the same raw f32 files as `bench/b1-run.mjs` and prints simple
//! `key=value` lines. This is a development benchmark, not the package API.

use std::fs;
use std::time::Instant;

use turbovec_core::TurboQuantIndex;

struct Args {
    vectors: String,
    queries: String,
    dim: usize,
    nq: usize,
    k: usize,
    repeats: usize,
}

fn parse() -> Args {
    let mut args = Args {
        vectors: String::new(),
        queries: String::new(),
        dim: 768,
        nq: 100,
        k: 10,
        repeats: 20,
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
            "--vectors" => {
                args.vectors = value(i);
                i += 2;
            }
            "--queries" => {
                args.queries = value(i);
                i += 2;
            }
            "--dim" => {
                args.dim = value(i).parse().unwrap();
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
            other => panic!("unknown argument {other}"),
        }
    }
    args
}

fn read_f32(path: &str) -> Vec<f32> {
    let bytes = fs::read(path).unwrap();
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect()
}

fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

fn main() {
    let args = parse();
    let vectors = read_f32(&args.vectors);
    let queries = read_f32(&args.queries);
    let dim = args.dim;

    let start = Instant::now();
    let mut index = TurboQuantIndex::new(dim, 4).unwrap();
    index.add_2d(&vectors, dim).unwrap();
    index.prepare();
    let add_ms = start.elapsed().as_secs_f64() * 1e3;

    let query = &queries[..dim];
    for _ in 0..10 {
        index.search(query, args.k);
    }
    let mut single = Vec::with_capacity(100);
    for _ in 0..100 {
        let start = Instant::now();
        let result = index.search(query, args.k);
        std::hint::black_box(&result);
        single.push(start.elapsed().as_secs_f64() * 1e3);
    }

    for _ in 0..3 {
        index.search(&queries, args.k);
    }
    let mut batch = Vec::with_capacity(args.repeats);
    for _ in 0..args.repeats {
        let start = Instant::now();
        let result = index.search(&queries, args.k);
        std::hint::black_box(&result);
        batch.push(start.elapsed().as_secs_f64() * 1e3);
    }

    let single_sorted = {
        let mut values = single.clone();
        values.sort_by(f64::total_cmp);
        values
    };
    let single_median = median(single);
    let batch_median = median(batch);
    println!("add_ms={:.3}", add_ms);
    println!("single_p50_ms={:.4}", single_median);
    println!(
        "single_p95_ms={:.4}",
        single_sorted[(single_sorted.len() * 95) / 100]
    );
    println!(
        "single_p99_ms={:.4}",
        single_sorted[(single_sorted.len() * 99) / 100]
    );
    println!("single_qps={:.1}", 1000.0 / single_median);
    println!("batch_p50_ms={:.3}", batch_median);
    println!("batch_qps={:.1}", args.nq as f64 / (batch_median / 1e3));
}
