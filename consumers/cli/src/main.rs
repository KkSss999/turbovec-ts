use turbovec_service::{Config, IndexKind, SearchResult, Service};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let dim = args
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8);
    let bits = args
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(4);

    let service = Service::new(Config::new(dim, bits, IndexKind::Dense))?;
    service.add(&demo_vectors(dim))?;

    let SearchResult::Dense(result) = service.search(&unit(dim, 0), 2)? else {
        unreachable!();
    };
    println!(
        "length={} dim={} bits={} k={}",
        service.len()?,
        dim,
        bits,
        result.k
    );
    println!("indices={:?}", result.indices);
    println!("stats={:?}", service.stats()?);
    Ok(())
}

fn unit(dim: usize, position: usize) -> Vec<f32> {
    let mut value = vec![0.0; dim];
    value[position % dim] = 1.0;
    value
}

fn demo_vectors(dim: usize) -> Vec<f32> {
    let mut vectors = Vec::with_capacity(dim * 3);
    for position in 0..3 {
        vectors.extend_from_slice(&unit(dim, position));
    }
    vectors
}
