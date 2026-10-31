//! Native Rust side of the binding benchmark suite.
//!
//! It consumes the same raw f32 files as `bench/node-bench.ts`, computes exact
//! top-k ground truth with rayon, and prints one JSON object. It is a benchmark
//! harness, not part of the npm package.

use std::env;
use std::fs;
use std::time::Instant;

use rayon::prelude::*;
use turbovec_core::TurboQuantIndex;

struct Args {
    vectors: String,
    queries: String,
    groundtruth: String,
    dim: usize,
    n: usize,
    nq: usize,
    k: usize,
    bits: usize,
    repeats: usize,
}

fn parse_args() -> Args {
    let mut args = Args {
        vectors: String::new(),
        queries: String::new(),
        groundtruth: String::new(),
        dim: 768,
        n: 20_000,
        nq: 100,
        k: 10,
        bits: 4,
        repeats: 5,
    };
    let argv: Vec<String> = env::args().skip(1).collect();
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
            "--groundtruth" => {
                args.groundtruth = value(i);
                i += 2;
            }
            "--dim" => {
                args.dim = value(i).parse().unwrap();
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
            "--bits" => {
                args.bits = value(i).parse().unwrap();
                i += 2;
            }
            "--repeats" => {
                args.repeats = value(i).parse().unwrap();
                i += 2;
            }
            other => panic!("unknown argument {other}"),
        }
    }
    assert!(!args.vectors.is_empty(), "--vectors is required");
    assert!(!args.queries.is_empty(), "--queries is required");
    assert!(!args.groundtruth.is_empty(), "--groundtruth is required");
    args
}

fn read_f32(path: &str) -> Vec<f32> {
    let bytes = fs::read(path).unwrap();
    assert_eq!(bytes.len() % 4, 0, "{path} is not f32-aligned");
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect()
}

fn read_groundtruth(path: &str) -> Option<Vec<u32>> {
    let bytes = fs::read(path).ok()?;
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return None;
    }
    Some(
        bytes
            .chunks_exact(4)
            .map(|chunk| u32::from_le_bytes(chunk.try_into().unwrap()))
            .collect(),
    )
}

fn exact_topk(
    vectors: &[f32],
    queries: &[f32],
    n: usize,
    dim: usize,
    nq: usize,
    k: usize,
) -> Vec<u32> {
    let mut result = vec![0u32; nq * k];
    result.par_chunks_mut(k).enumerate().for_each(|(qi, out)| {
        let query = &queries[qi * dim..(qi + 1) * dim];
        let mut scored: Vec<(f32, u32)> = (0..n)
            .map(|i| {
                let vector = &vectors[i * dim..(i + 1) * dim];
                let mut score = 0.0f32;
                for (a, b) in query.iter().zip(vector) {
                    score += a * b;
                }
                (score, i as u32)
            })
            .collect();
        scored.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        for (slot, (_, index)) in scored.iter().take(k).enumerate() {
            out[slot] = *index;
        }
    });
    result
}

fn recall(groundtruth: &[u32], found: &[i64], nq: usize, k: usize) -> f64 {
    let mut hits = 0usize;
    for qi in 0..nq {
        let expected = &groundtruth[qi * k..(qi + 1) * k];
        let actual = &found[qi * k..(qi + 1) * k];
        for index in actual {
            if expected.contains(&(*index as u32)) {
                hits += 1;
            }
        }
    }
    hits as f64 / (nq * k) as f64
}

fn recall_at_1(groundtruth: &[u32], found: &[i64], nq: usize, k: usize) -> f64 {
    let mut hits = 0usize;
    for qi in 0..nq {
        if found[qi * k] as u32 == groundtruth[qi * k] {
            hits += 1;
        }
    }
    hits as f64 / nq as f64
}

fn read_vm_kb(field: &str) -> Option<f64> {
    let status = fs::read_to_string("/proc/self/status").ok()?;
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix(field) {
            let kb = rest.split_whitespace().next()?.parse::<f64>().ok()?;
            return Some(kb / 1024.0);
        }
    }
    None
}

fn number(value: Option<f64>) -> String {
    value.map_or_else(|| "null".to_string(), |value| format!("{value:.3}"))
}

fn estimated_index_bytes(dim: usize, bits: usize, n: usize) -> usize {
    let codes_per_byte = 8 / bits;
    let n_byte_groups = dim / codes_per_byte;
    let n_blocks = n.saturating_add(31) / 32;
    let codes = n_blocks.saturating_mul(n_byte_groups).saturating_mul(32);
    let scales = n.saturating_mul(4);
    let calibration = dim.saturating_mul(4).saturating_mul(2);
    codes
        .saturating_add(scales)
        .saturating_add(calibration)
        .saturating_add(4096)
}

fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

fn main() {
    let args = parse_args();
    let rss_before = read_vm_kb("VmRSS:");
    let vectors = read_f32(&args.vectors);
    let queries = read_f32(&args.queries);
    assert_eq!(vectors.len(), args.n * args.dim, "vector shape mismatch");
    assert_eq!(queries.len(), args.nq * args.dim, "query shape mismatch");

    let expected_len = args.nq * args.k;
    let groundtruth = match read_groundtruth(&args.groundtruth) {
        Some(values) if values.len() == expected_len => values,
        _ => {
            let values = exact_topk(&vectors, &queries, args.n, args.dim, args.nq, args.k);
            let bytes: Vec<u8> = values
                .iter()
                .flat_map(|value| value.to_le_bytes())
                .collect();
            fs::write(&args.groundtruth, bytes).unwrap();
            values
        }
    };

    let build_start = Instant::now();
    let mut index = TurboQuantIndex::new(args.dim, args.bits).unwrap();
    index.add_2d(&vectors, args.dim).unwrap();
    let sample_rows = args.n.min(1024);
    index
        .calibrate_2d(&vectors[..sample_rows * args.dim], args.dim)
        .unwrap();
    index.prepare();
    let build_ms = build_start.elapsed().as_secs_f64() * 1e3;
    let rss_after_build = read_vm_kb("VmRSS:");
    let serialized_bytes = index.serialized_len();

    drop(vectors);
    let rss_after_release = read_vm_kb("VmRSS:");

    index.search(&queries, args.k);
    index.search(&queries, args.k);
    let mut times = Vec::with_capacity(args.repeats);
    let mut last = index.search(&queries, args.k);
    for _ in 0..args.repeats {
        let start = Instant::now();
        last = index.search(&queries, args.k);
        times.push(start.elapsed().as_secs_f64() * 1e3);
    }
    let search_ms = median(times);
    let effective_k = last.k;
    let recall_at_k = recall(&groundtruth, &last.indices, args.nq, effective_k);
    let recall_at_1 = recall_at_1(&groundtruth, &last.indices, args.nq, effective_k);

    println!("{{");
    println!("  \"impl\": \"rust\",");
    println!("  \"threads\": {},", rayon::current_num_threads());
    println!("  \"dim\": {},", args.dim);
    println!("  \"n\": {},", args.n);
    println!("  \"nq\": {},", args.nq);
    println!("  \"k\": {},", effective_k);
    println!("  \"bits\": {},", args.bits);
    println!("  \"repeats\": {},", args.repeats);
    println!("  \"buildMs\": {:.3},", build_ms);
    println!("  \"searchBatchMs\": {:.3},", search_ms);
    println!("  \"perQueryMs\": {:.6},", search_ms / args.nq as f64);
    println!("  \"qps\": {:.3},", args.nq as f64 / (search_ms / 1e3));
    println!("  \"recallAtK\": {:.6},", recall_at_k);
    println!("  \"recallAt1\": {:.6},", recall_at_1);
    println!("  \"rssBeforeMb\": {},", number(rss_before));
    println!("  \"rssAfterBuildMb\": {},", number(rss_after_build));
    println!("  \"rssAfterReleaseMb\": {},", number(rss_after_release));
    println!("  \"peakRssMb\": {},", number(read_vm_kb("VmHWM:")));
    println!("  \"serializedBytes\": {},", serialized_bytes);
    println!(
        "  \"estimatedIndexBytes\": {}",
        estimated_index_bytes(args.dim, args.bits, args.n)
    );
    println!("}}");
}
