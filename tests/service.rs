use std::sync::Arc;
use std::thread;

use tempfile::tempdir;
use turbovec_service::{Config, Durability, ErrorCode, IndexKind, SearchResult, Service};

fn vectors() -> Vec<f32> {
    vec![
        1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        1.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    ]
}

fn query() -> Vec<f32> {
    vec![1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
}

fn expect_error<T>(result: Result<T, turbovec_service::ServiceError>, code: ErrorCode) {
    match result {
        Ok(_) => panic!("expected {code:?}, got success"),
        Err(error) => assert_eq!(error.code(), code, "{error}"),
    }
}

#[test]
fn dense_add_search_and_stats() {
    let service = Service::new(Config::new(8, 4, IndexKind::Dense)).unwrap();
    service.add(&vectors()).unwrap();
    assert_eq!(service.len().unwrap(), 3);

    let SearchResult::Dense(result) = service.search(&query(), 1).unwrap() else {
        panic!("wrong result kind");
    };
    assert_eq!(result.nq, 1);
    assert_eq!(result.k, 1);
    assert_eq!(result.indices[0], 0);
    assert_eq!(result.scores.len(), 1);

    let stats = service.stats().unwrap();
    assert_eq!(stats.kind, IndexKind::Dense);
    assert_eq!(stats.len, 3);
    assert!(stats.serialized_bytes > 0);
    assert!(stats.estimated_bytes > 0);
}

#[test]
fn dense_mask_and_swap_remove() {
    let service = Service::new(Config::new(8, 4, IndexKind::Dense)).unwrap();
    service.add(&vectors()).unwrap();

    let SearchResult::Dense(result) = service
        .search_with_mask(&query(), 3, &[false, true, false])
        .unwrap()
    else {
        panic!("wrong result kind");
    };
    assert_eq!(result.indices, vec![1]);

    assert_eq!(service.swap_remove(0).unwrap(), 2);
    assert_eq!(service.len().unwrap(), 2);
    expect_error(service.swap_remove(99), ErrorCode::InvalidInput);
}

#[test]
fn id_map_add_search_filter_remove() {
    let service = Service::new(Config::new(8, 4, IndexKind::IdMap)).unwrap();
    service.add_with_ids(&vectors(), &[10, 20, 30]).unwrap();
    assert_eq!(service.len().unwrap(), 3);
    assert_eq!(service.iter_ids().unwrap(), vec![10, 20, 30]);
    assert!(service.contains(20).unwrap());

    let SearchResult::IdMap(result) = service.search(&query(), 2).unwrap() else {
        panic!("wrong result kind");
    };
    assert_eq!(result.ids[0], 10);

    let SearchResult::IdMap(filtered) = service
        .search_with_allowlist(&query(), 2, &[10, 30])
        .unwrap()
    else {
        panic!("wrong result kind");
    };
    assert_eq!(filtered.ids, vec![10, 30]);

    assert!(service.remove(20).unwrap());
    assert!(!service.remove(20).unwrap());
    assert!(!service.contains(20).unwrap());
    assert_eq!(service.len().unwrap(), 2);
}

#[test]
fn two_three_and_four_bit_indexes_work() {
    for bits in [2, 3, 4] {
        let service = Service::new(Config::new(8, bits, IndexKind::Dense)).unwrap();
        service.add(&query()).unwrap();
        let SearchResult::Dense(result) = service.search(&query(), 1).unwrap() else {
            panic!("wrong result kind");
        };
        assert_eq!(result.indices, vec![0]);
        assert_eq!(service.bit_width(), bits);
    }
}

#[test]
fn full_snapshot_round_trip() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("index.tv");
    let service = Service::new(Config::new(8, 4, IndexKind::Dense)).unwrap();
    service.add(&vectors()).unwrap();
    service.checkpoint(&path, Durability::Durable).unwrap();

    let loaded = Service::load(IndexKind::Dense, &path).unwrap();
    assert_eq!(loaded.len().unwrap(), 3);
    let SearchResult::Dense(result) = loaded.search(&query(), 1).unwrap() else {
        panic!("wrong result kind");
    };
    assert_eq!(result.indices, vec![0]);
}

#[test]
fn id_map_snapshot_round_trip() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("index.tvim");
    let service = Service::new(Config::new(8, 4, IndexKind::IdMap)).unwrap();
    service.add_with_ids(&vectors(), &[1, 2, 3]).unwrap();
    service.write(&path, Durability::Durable).unwrap();

    let loaded = Service::load(IndexKind::IdMap, &path).unwrap();
    assert_eq!(loaded.iter_ids().unwrap(), vec![1, 2, 3]);
}

#[test]
fn bytes_round_trip_and_sync() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("sync.tv");
    let service = Service::new(Config::new(8, 4, IndexKind::Dense)).unwrap();
    service.add(&query()).unwrap();

    let bytes = service.to_bytes().unwrap();
    assert_eq!(bytes.len(), service.serialized_len().unwrap());
    let from_bytes = Service::from_bytes(IndexKind::Dense, &bytes).unwrap();
    assert_eq!(from_bytes.len().unwrap(), 1);

    service.sync(&path).unwrap();
    let synced = Service::load(IndexKind::Dense, &path).unwrap();
    assert_eq!(synced.len().unwrap(), 1);
}

#[test]
fn invalid_input_and_kind_errors() {
    expect_error(
        Service::new(Config::new(7, 4, IndexKind::Dense)),
        ErrorCode::InvalidInput,
    );
    expect_error(
        Service::new(Config::new(8, 1, IndexKind::Dense)),
        ErrorCode::InvalidInput,
    );

    let dense = Service::new(Config::new(8, 4, IndexKind::Dense)).unwrap();
    expect_error(dense.add(&[1.0, 2.0, 3.0]), ErrorCode::InvalidInput);
    expect_error(dense.add_with_ids(&query(), &[1]), ErrorCode::Unsupported);
    expect_error(dense.search(&[1.0], 1), ErrorCode::InvalidInput);

    let id_map = Service::new(Config::new(8, 4, IndexKind::IdMap)).unwrap();
    expect_error(id_map.add(&query()), ErrorCode::Unsupported);
    expect_error(
        id_map.add_with_ids(&vectors(), &[1]),
        ErrorCode::InvalidInput,
    );
}

#[test]
fn close_is_idempotent_and_rejects_later_calls() {
    let service = Service::new(Config::new(8, 4, IndexKind::Dense)).unwrap();
    service.close().unwrap();
    service.close().unwrap();
    assert!(service.is_closed());
    assert_eq!(service.stats().unwrap_err().code(), ErrorCode::Disposed);
    expect_error(service.add(&query()), ErrorCode::Disposed);
}

#[test]
fn searches_can_run_concurrently() {
    let service = Arc::new(Service::new(Config::new(8, 4, IndexKind::Dense)).unwrap());
    service.add(&vectors()).unwrap();
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let service = Arc::clone(&service);
            thread::spawn(move || {
                let SearchResult::Dense(result) = service.search(&query(), 1).unwrap() else {
                    panic!("wrong result kind");
                };
                assert_eq!(result.indices, vec![0]);
            })
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }
}

#[test]
fn missing_file_is_an_io_error() {
    let dir = tempdir().unwrap();
    expect_error(
        Service::load(IndexKind::Dense, dir.path().join("missing.tv")),
        ErrorCode::Io,
    );
}
