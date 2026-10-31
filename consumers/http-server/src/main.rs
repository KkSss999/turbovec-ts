//! Minimal consumer-owned HTTP example.
//!
//! The library does not ship a server, auth, queue, or wire protocol. This
//! example shows one way to wrap the Rust API. Add authentication, request
//! limits, and binary payloads before using it in production.

use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use turbovec_service::{Config, IndexKind, SearchResult, Service};

#[derive(Clone)]
struct App {
    service: Arc<Service>,
}

#[derive(Deserialize)]
struct SearchRequest {
    query: Vec<f32>,
    k: usize,
}

#[derive(Serialize)]
struct SearchResponse {
    scores: Vec<f32>,
    indices: Vec<usize>,
}

async fn health() -> &'static str {
    "ok"
}

async fn search(
    State(app): State<App>,
    Json(request): Json<SearchRequest>,
) -> Result<Json<SearchResponse>, (StatusCode, String)> {
    let service = Arc::clone(&app.service);
    let result = tokio::task::spawn_blocking(move || service.search(&request.query, request.k))
        .await
        .map_err(internal)?
        .map_err(internal)?;
    let SearchResult::Dense(result) = result else {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, "wrong index kind".into()));
    };
    Ok(Json(SearchResponse {
        scores: result.scores,
        indices: result
            .indices
            .into_iter()
            .map(|index| index as usize)
            .collect(),
    }))
}

fn internal(error: impl std::fmt::Display) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let service = Service::new(Config::new(8, 4, IndexKind::Dense))?;
    let mut vectors = Vec::with_capacity(24);
    vectors.extend_from_slice(&[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    vectors.extend_from_slice(&[0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    vectors.extend_from_slice(&[0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    service.add(&vectors)?;

    let app = App {
        service: Arc::new(service),
    };
    let router = Router::new()
        .route("/health", get(health))
        .route("/search", post(search))
        .with_state(app);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await?;
    println!("http://127.0.0.1:3000");
    axum::serve(listener, router).await?;
    Ok(())
}
