use std::path::Path;
use std::sync::RwLock;

use turbovec_core::{IdMapIndex, IdSearchResults, SearchResults, TurboQuantIndex};

use crate::error::ServiceError;

pub use turbovec_core::io::Durability;

/// Which address space the index uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexKind {
    /// Positional slots, returned as `i64` slot indices.
    Dense,
    /// Stable external `u64` ids.
    IdMap,
}

/// Construction parameters for a new index.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Config {
    pub dim: usize,
    pub bit_width: usize,
    pub kind: IndexKind,
}

impl Config {
    pub fn new(dim: usize, bit_width: usize, kind: IndexKind) -> Self {
        Self {
            dim,
            bit_width,
            kind,
        }
    }

    fn validate(self) -> Result<(), ServiceError> {
        if self.dim == 0 || !self.dim.is_multiple_of(8) {
            return Err(ServiceError::invalid(format!(
                "dim must be a positive multiple of 8, got {}",
                self.dim
            )));
        }
        if !(2..=4).contains(&self.bit_width) {
            return Err(ServiceError::invalid(format!(
                "bit_width must be 2, 3, or 4, got {}",
                self.bit_width
            )));
        }
        Ok(())
    }
}

/// Result of a search. The caller knows the service kind and can match once.
#[derive(Debug, Clone, PartialEq)]
pub enum SearchResult {
    Dense(SearchResults),
    IdMap(IdSearchResults),
}

/// Index statistics that do not require external accounting.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stats {
    pub kind: IndexKind,
    pub dim: usize,
    pub bit_width: usize,
    pub len: usize,
    pub serialized_bytes: usize,
    pub estimated_bytes: usize,
}

impl Stats {
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

enum Index {
    Dense(TurboQuantIndex),
    IdMap(IdMapIndex),
}

impl Index {
    fn len(&self) -> usize {
        match self {
            Self::Dense(index) => index.len(),
            Self::IdMap(index) => index.len(),
        }
    }

    fn serialized_len(&self) -> usize {
        match self {
            Self::Dense(index) => index.serialized_len(),
            // IdMapIndex does not expose a length-only method; materialize the
            // image. This is a rare stats call, not a search path.
            Self::IdMap(index) => index.to_bytes().len(),
        }
    }
}

/// A single owned index plus service-level lifecycle and error handling.
///
/// The service is a library type: it does not open sockets, start threads, or
/// impose a global request queue. Consumers own transport and admission
/// control. Methods use an internal read/write lock, so search can overlap
/// search while mutations and sync take exclusivity.
pub struct Service {
    dim: usize,
    bit_width: usize,
    kind: IndexKind,
    inner: RwLock<Option<Index>>,
}

impl Service {
    /// Create an empty index.
    pub fn new(config: Config) -> Result<Self, ServiceError> {
        config.validate()?;
        let index = match config.kind {
            IndexKind::Dense => Index::Dense(
                TurboQuantIndex::new(config.dim, config.bit_width).map_err(ServiceError::native)?,
            ),
            IndexKind::IdMap => Index::IdMap(
                IdMapIndex::new(config.dim, config.bit_width).map_err(ServiceError::native)?,
            ),
        };
        Ok(Self {
            dim: config.dim,
            bit_width: config.bit_width,
            kind: config.kind,
            inner: RwLock::new(Some(index)),
        })
    }

    /// Load an index from a `.tv` or `.tvim` file. The kind must match the file.
    pub fn load(kind: IndexKind, path: impl AsRef<Path>) -> Result<Self, ServiceError> {
        let index = match kind {
            IndexKind::Dense => {
                Index::Dense(TurboQuantIndex::load(path.as_ref()).map_err(ServiceError::from)?)
            }
            IndexKind::IdMap => {
                Index::IdMap(IdMapIndex::load(path.as_ref()).map_err(ServiceError::from)?)
            }
        };
        Self::from_index(kind, index)
    }

    /// Load an index from bytes produced by [`Self::to_bytes`].
    pub fn from_bytes(kind: IndexKind, bytes: &[u8]) -> Result<Self, ServiceError> {
        let index = match kind {
            IndexKind::Dense => {
                Index::Dense(TurboQuantIndex::from_bytes(bytes).map_err(ServiceError::from)?)
            }
            IndexKind::IdMap => {
                Index::IdMap(IdMapIndex::from_bytes(bytes).map_err(ServiceError::from)?)
            }
        };
        Self::from_index(kind, index)
    }

    fn from_index(kind: IndexKind, index: Index) -> Result<Self, ServiceError> {
        let (dim, bit_width) = match &index {
            Index::Dense(index) => (
                index
                    .dim_opt()
                    .ok_or_else(|| ServiceError::unsupported("lazy indexes are not supported"))?,
                index.bit_width(),
            ),
            Index::IdMap(index) => (
                index
                    .dim_opt()
                    .ok_or_else(|| ServiceError::unsupported("lazy indexes are not supported"))?,
                index.bit_width(),
            ),
        };
        Ok(Self {
            dim,
            bit_width,
            kind,
            inner: RwLock::new(Some(index)),
        })
    }

    pub fn kind(&self) -> IndexKind {
        self.kind
    }

    pub fn dim(&self) -> usize {
        self.dim
    }

    pub fn bit_width(&self) -> usize {
        self.bit_width
    }

    pub fn is_closed(&self) -> bool {
        self.inner
            .read()
            .map(|guard| guard.is_none())
            .unwrap_or(true)
    }

    /// Close the service. Later operations fail with [`crate::ErrorCode::Disposed`].
    pub fn close(&self) -> Result<(), ServiceError> {
        let mut guard = self.inner.write().map_err(|_| ServiceError::locked())?;
        *guard = None;
        Ok(())
    }

    pub fn len(&self) -> Result<usize, ServiceError> {
        let guard = self.inner.read().map_err(|_| ServiceError::locked())?;
        let index = guard.as_ref().ok_or_else(ServiceError::disposed)?;
        Ok(index.len())
    }

    pub fn is_empty(&self) -> Result<bool, ServiceError> {
        Ok(self.len()? == 0)
    }

    /// Append dense rows. Only valid for [`IndexKind::Dense`].
    pub fn add(&self, vectors: &[f32]) -> Result<(), ServiceError> {
        self.require_multiple(vectors.len(), "vectors")?;
        let mut guard = self.inner.write().map_err(|_| ServiceError::locked())?;
        let index = guard.as_mut().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::Dense(index) => index
                .add_2d(vectors, self.dim)
                .map_err(ServiceError::native),
            Index::IdMap(_) => Err(ServiceError::unsupported(
                "add is only valid for a dense index; use add_with_ids",
            )),
        }
    }

    /// Append rows with external ids. Only valid for [`IndexKind::IdMap`].
    pub fn add_with_ids(&self, vectors: &[f32], ids: &[u64]) -> Result<(), ServiceError> {
        self.require_multiple(vectors.len(), "vectors")?;
        let rows = vectors.len() / self.dim;
        if ids.len() != rows {
            return Err(ServiceError::invalid(format!(
                "expected {rows} ids, got {}",
                ids.len()
            )));
        }
        let mut guard = self.inner.write().map_err(|_| ServiceError::locked())?;
        let index = guard.as_mut().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::IdMap(index) => index
                .add_with_ids_2d(vectors, self.dim, ids)
                .map_err(ServiceError::native),
            Index::Dense(_) => Err(ServiceError::unsupported(
                "add_with_ids is only valid for an id-map index",
            )),
        }
    }

    /// Run an unfiltered search.
    pub fn search(&self, queries: &[f32], k: usize) -> Result<SearchResult, ServiceError> {
        self.require_multiple(queries.len(), "queries")?;
        let guard = self.inner.read().map_err(|_| ServiceError::locked())?;
        let index = guard.as_ref().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::Dense(index) => index
                .try_search(queries, k)
                .map(SearchResult::Dense)
                .map_err(ServiceError::native),
            Index::IdMap(index) => index
                .try_search(queries, k)
                .map(SearchResult::IdMap)
                .map_err(ServiceError::native),
        }
    }

    /// Dense search restricted by a per-slot boolean mask.
    pub fn search_with_mask(
        &self,
        queries: &[f32],
        k: usize,
        mask: &[bool],
    ) -> Result<SearchResult, ServiceError> {
        self.require_multiple(queries.len(), "queries")?;
        let guard = self.inner.read().map_err(|_| ServiceError::locked())?;
        let index = guard.as_ref().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::Dense(index) => index
                .try_search_with_mask(queries, k, Some(mask))
                .map(SearchResult::Dense)
                .map_err(ServiceError::native),
            Index::IdMap(_) => Err(ServiceError::unsupported(
                "search_with_mask is only valid for a dense index",
            )),
        }
    }

    /// Id-map search restricted by an allowlist.
    pub fn search_with_allowlist(
        &self,
        queries: &[f32],
        k: usize,
        allowlist: &[u64],
    ) -> Result<SearchResult, ServiceError> {
        self.require_multiple(queries.len(), "queries")?;
        let guard = self.inner.read().map_err(|_| ServiceError::locked())?;
        let index = guard.as_ref().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::IdMap(index) => index
                .try_search_with_allowlist(queries, k, Some(allowlist))
                .map(SearchResult::IdMap)
                .map_err(ServiceError::native),
            Index::Dense(_) => Err(ServiceError::unsupported(
                "search_with_allowlist is only valid for an id-map index",
            )),
        }
    }

    /// Dense-only swap removal. Returns the slot that was moved.
    pub fn swap_remove(&self, slot: usize) -> Result<usize, ServiceError> {
        let mut guard = self.inner.write().map_err(|_| ServiceError::locked())?;
        let index = guard.as_mut().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::Dense(index) => {
                if slot >= index.len() {
                    return Err(ServiceError::invalid(format!(
                        "slot {slot} is out of range for {} rows",
                        index.len()
                    )));
                }
                Ok(index.swap_remove(slot))
            }
            Index::IdMap(_) => Err(ServiceError::unsupported(
                "swap_remove is only valid for a dense index",
            )),
        }
    }

    /// Id-map-only removal. Returns false when the id is absent.
    pub fn remove(&self, id: u64) -> Result<bool, ServiceError> {
        let mut guard = self.inner.write().map_err(|_| ServiceError::locked())?;
        let index = guard.as_mut().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::IdMap(index) => Ok(index.remove(id)),
            Index::Dense(_) => Err(ServiceError::unsupported(
                "remove is only valid for an id-map index",
            )),
        }
    }

    pub fn contains(&self, id: u64) -> Result<bool, ServiceError> {
        let guard = self.inner.read().map_err(|_| ServiceError::locked())?;
        let index = guard.as_ref().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::IdMap(index) => Ok(index.contains(id)),
            Index::Dense(_) => Err(ServiceError::unsupported(
                "contains is only valid for an id-map index",
            )),
        }
    }

    pub fn iter_ids(&self) -> Result<Vec<u64>, ServiceError> {
        let guard = self.inner.read().map_err(|_| ServiceError::locked())?;
        let index = guard.as_ref().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::IdMap(index) => Ok(index.iter_ids().collect()),
            Index::Dense(_) => Err(ServiceError::unsupported(
                "iter_ids is only valid for an id-map index",
            )),
        }
    }

    pub fn calibrate(&self, sample: &[f32]) -> Result<(), ServiceError> {
        self.require_multiple(sample.len(), "calibration sample")?;
        let mut guard = self.inner.write().map_err(|_| ServiceError::locked())?;
        let index = guard.as_mut().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::Dense(index) => index
                .calibrate_2d(sample, self.dim)
                .map_err(ServiceError::native),
            Index::IdMap(index) => index
                .calibrate_2d(sample, self.dim)
                .map_err(ServiceError::native),
        }
    }

    pub fn prepare(&self) -> Result<(), ServiceError> {
        let guard = self.inner.read().map_err(|_| ServiceError::locked())?;
        let index = guard.as_ref().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::Dense(index) => index.prepare(),
            Index::IdMap(index) => index.prepare(),
        }
        Ok(())
    }

    /// Write a full snapshot. `Durability::Durable` is the safe default.
    pub fn write(
        &self,
        path: impl AsRef<Path>,
        durability: Durability,
    ) -> Result<(), ServiceError> {
        let guard = self.inner.read().map_err(|_| ServiceError::locked())?;
        let index = guard.as_ref().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::Dense(index) => index
                .write_with_durability(path.as_ref(), durability)
                .map_err(ServiceError::from),
            Index::IdMap(index) => index
                .write_with_durability(path.as_ref(), durability)
                .map_err(ServiceError::from),
        }
    }

    /// Alias for a full snapshot.
    pub fn checkpoint(
        &self,
        path: impl AsRef<Path>,
        durability: Durability,
    ) -> Result<(), ServiceError> {
        self.write(path, durability)
    }

    /// Incrementally persist to a single writer path.
    pub fn sync(&self, path: impl AsRef<Path>) -> Result<(), ServiceError> {
        let mut guard = self.inner.write().map_err(|_| ServiceError::locked())?;
        let index = guard.as_mut().ok_or_else(ServiceError::disposed)?;
        match index {
            Index::Dense(index) => index.sync(path.as_ref()).map_err(ServiceError::from),
            Index::IdMap(index) => index.sync(path.as_ref()).map_err(ServiceError::from),
        }
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, ServiceError> {
        let guard = self.inner.read().map_err(|_| ServiceError::locked())?;
        let index = guard.as_ref().ok_or_else(ServiceError::disposed)?;
        Ok(match index {
            Index::Dense(index) => index.to_bytes(),
            Index::IdMap(index) => index.to_bytes(),
        })
    }

    /// Exact serialized size. For an id-map this currently materializes the
    /// image because the core does not expose a length-only method.
    pub fn serialized_len(&self) -> Result<usize, ServiceError> {
        let guard = self.inner.read().map_err(|_| ServiceError::locked())?;
        let index = guard.as_ref().ok_or_else(ServiceError::disposed)?;
        Ok(index.serialized_len())
    }

    pub fn stats(&self) -> Result<Stats, ServiceError> {
        let guard = self.inner.read().map_err(|_| ServiceError::locked())?;
        let index = guard.as_ref().ok_or_else(ServiceError::disposed)?;
        let len = index.len();
        let serialized_bytes = index.serialized_len();
        let estimated_bytes =
            estimated_bytes(self.dim, self.bit_width, len, self.kind == IndexKind::IdMap);
        Ok(Stats {
            kind: self.kind,
            dim: self.dim,
            bit_width: self.bit_width,
            len,
            serialized_bytes,
            estimated_bytes,
        })
    }

    fn require_multiple(&self, len: usize, name: &str) -> Result<(), ServiceError> {
        if !len.is_multiple_of(self.dim) {
            return Err(ServiceError::invalid(format!(
                "{name} length must be a multiple of dim {}",
                self.dim
            )));
        }
        Ok(())
    }
}

fn estimated_bytes(dim: usize, bit_width: usize, n: usize, with_ids: bool) -> usize {
    let codes_per_byte = 8 / bit_width;
    let n_byte_groups = dim / codes_per_byte;
    let n_blocks = n.saturating_add(31) / 32;
    let codes = n_blocks.saturating_mul(n_byte_groups).saturating_mul(32);
    let scales = n.saturating_mul(4);
    let calibration = dim.saturating_mul(4).saturating_mul(2);
    let ids = if with_ids { n.saturating_mul(8) } else { 0 };
    codes
        .saturating_add(scales)
        .saturating_add(calibration)
        .saturating_add(ids)
        .saturating_add(4096)
}
