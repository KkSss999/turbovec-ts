use std::sync::{Arc, RwLock};

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Inner index shared between the JS handle and native worker threads.
type Inner = Arc<RwLock<turbovec_core::TurboQuantIndex>>;

#[napi(object)]
pub struct SearchResult {
    pub scores: Float32Array,
    pub indices: Vec<i64>,
    pub nq: u32,
    pub k: u32,
}

#[napi]
pub struct TurboQuantIndex {
    inner: Inner,
    dim: u32,
    bit_width: u32,
}

#[napi]
impl TurboQuantIndex {
    #[napi(constructor)]
    pub fn new(dim: u32, bit_width: Option<u32>) -> Result<Self> {
        let bit_width = bit_width.unwrap_or(4);
        let index = turbovec_core::TurboQuantIndex::new(dim as usize, bit_width as usize)
            .map_err(|e| Error::from_reason(e.to_string()))?;

        Ok(Self {
            inner: Arc::new(RwLock::new(index)),
            dim,
            bit_width,
        })
    }

    #[napi]
    pub async fn add(&self, vectors: Float32Array) -> Result<()> {
        let data = vectors.to_vec();
        let dim = self.dim as usize;
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let mut index = inner
                .write()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            index
                .add_2d(&data, dim)
                .map_err(|e| Error::from_reason(e.to_string()))?;
            Ok(())
        })
        .await
        .map_err(|e| Error::from_reason(format!("native add failed: {e}")))??;

        Ok(())
    }

    #[napi]
    pub async fn search(&self, queries: Float32Array, k: u32) -> Result<SearchResult> {
        let data = queries.to_vec();
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || {
            let index = inner
                .read()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            let results = index
                .try_search(&data, k as usize)
                .map_err(|e| Error::from_reason(e.to_string()))?;

            Ok(SearchResult {
                scores: results.scores.into(),
                indices: results.indices,
                nq: results.nq as u32,
                k: results.k as u32,
            })
        })
        .await
        .map_err(|e| Error::from_reason(format!("native search failed: {e}")))?
    }

    #[napi]
    pub fn to_bytes(&self) -> Result<Buffer> {
        let index = self
            .inner
            .read()
            .map_err(|_| Error::from_reason("index lock poisoned"))?;
        Ok(index.to_bytes().into())
    }

    #[napi(factory)]
    pub fn from_bytes(data: Buffer) -> Result<Self> {
        let index = turbovec_core::TurboQuantIndex::from_bytes(&data)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        let dim = index
            .dim_opt()
            .ok_or_else(|| Error::from_reason("lazy indexes are not supported yet"))?;
        let bit_width = index.bit_width();

        Ok(Self {
            inner: Arc::new(RwLock::new(index)),
            dim: dim as u32,
            bit_width: bit_width as u32,
        })
    }

    #[napi(getter)]
    pub fn length(&self) -> Result<u32> {
        let index = self
            .inner
            .read()
            .map_err(|_| Error::from_reason("index lock poisoned"))?;
        u32::try_from(index.len()).map_err(|_| Error::from_reason("index length exceeds u32"))
    }

    #[napi(getter)]
    pub fn dim(&self) -> u32 {
        self.dim
    }

    #[napi(getter)]
    pub fn bit_width(&self) -> u32 {
        self.bit_width
    }
}
