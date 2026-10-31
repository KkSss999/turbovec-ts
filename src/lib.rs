//! Rust service-layer API for turbovec indexes.
//!
//! This crate owns one index per [`Service`] and adds service-level lifecycle,
//! validation, persistence, and statistics. It deliberately does not provide
//! HTTP, gRPC, IPC, authentication, or a global request queue. Those belong to
//! the consumer's server layer.

mod error;
mod service;

pub use error::{ErrorCode, ServiceError};
pub use service::{Config, Durability, IndexKind, SearchResult, Service, Stats};
pub use turbovec_core::{IdSearchResults, SearchResults};
