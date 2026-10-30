use std::sync::{Arc, RwLock};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use turbovec_core::io::Durability;
use turbovec_core::CalibrationState;

/// Inner index shared between the JS handle and native worker threads.
type Inner = Arc<RwLock<turbovec_core::TurboQuantIndex>>;
type IdInner = Arc<RwLock<turbovec_core::IdMapIndex>>;

fn bigint_to_u64(value: BigInt) -> Result<u64> {
    let (negative, value, lossless) = value.get_u64();
    if negative || !lossless {
        return Err(Error::from_reason("id must fit in u64"));
    }
    Ok(value)
}

#[napi(object)]
pub struct SearchResult {
    pub scores: Float32Array,
    pub indices: Vec<i64>,
    pub nq: u32,
    pub k: u32,
}

#[napi(object)]
pub struct IdSearchResult {
    pub scores: Float32Array,
    pub ids: BigUint64Array,
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
    pub async fn search(
        &self,
        queries: Float32Array,
        k: u32,
        mask: Option<Uint8Array>,
    ) -> Result<SearchResult> {
        let data = queries.to_vec();
        let mask = mask.map(|m| m.to_vec().into_iter().map(|b| b != 0).collect::<Vec<bool>>());
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<SearchResult> {
            let index = inner
                .read()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            let results = index
                .try_search_with_mask(&data, k as usize, mask.as_deref())
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

    fn from_core(index: turbovec_core::TurboQuantIndex) -> Result<Self> {
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

    #[napi(factory)]
    pub fn from_bytes(data: Buffer) -> Result<Self> {
        let index = turbovec_core::TurboQuantIndex::from_bytes(&data)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Self::from_core(index)
    }

    #[napi(factory)]
    pub async fn load(path: String) -> Result<Self> {
        napi::tokio::task::spawn_blocking(move || -> Result<Self> {
            let index = turbovec_core::TurboQuantIndex::load(path)
                .map_err(|e| Error::from_reason(e.to_string()))?;
            Self::from_core(index)
        })
        .await
        .map_err(|e| Error::from_reason(format!("native load failed: {e}")))?
    }

    #[napi]
    pub async fn write(&self, path: String, durable: Option<bool>) -> Result<()> {
        let inner = Arc::clone(&self.inner);
        let durability = match durable.unwrap_or(true) {
            true => Durability::Durable,
            false => Durability::Fast,
        };

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let index = inner
                .read()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            index
                .write_with_durability(path, durability)
                .map_err(|e| Error::from_reason(e.to_string()))
        })
        .await
        .map_err(|e| Error::from_reason(format!("native write failed: {e}")))?
    }

    #[napi]
    pub async fn sync(&self, path: String) -> Result<()> {
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let mut index = inner
                .write()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            index
                .sync(path)
                .map_err(|e| Error::from_reason(e.to_string()))
        })
        .await
        .map_err(|e| Error::from_reason(format!("native sync failed: {e}")))?
    }

    #[napi]
    pub async fn calibrate(&self, sample: Float32Array) -> Result<()> {
        let data = sample.to_vec();
        let dim = self.dim as usize;
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let mut index = inner
                .write()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            index
                .calibrate_2d(&data, dim)
                .map_err(|e| Error::from_reason(e.to_string()))
        })
        .await
        .map_err(|e| Error::from_reason(format!("native calibrate failed: {e}")))?
    }

    #[napi]
    pub async fn prepare(&self) -> Result<()> {
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let index = inner
                .read()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            index.prepare();
            Ok(())
        })
        .await
        .map_err(|e| Error::from_reason(format!("native prepare failed: {e}")))?
    }

    #[napi(getter)]
    pub fn calibration_state(&self) -> Result<String> {
        let index = self
            .inner
            .read()
            .map_err(|_| Error::from_reason("index lock poisoned"))?;
        Ok(match index.calibration_state() {
            CalibrationState::Uncalibrated => "uncalibrated",
            CalibrationState::Calibrated => "calibrated",
            _ => "unknown",
        }
        .to_string())
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

#[napi]
pub struct IdMapIndex {
    inner: IdInner,
    dim: u32,
    bit_width: u32,
}

#[napi]
impl IdMapIndex {
    #[napi(constructor)]
    pub fn new(dim: u32, bit_width: Option<u32>) -> Result<Self> {
        let bit_width = bit_width.unwrap_or(4);
        let index = turbovec_core::IdMapIndex::new(dim as usize, bit_width as usize)
            .map_err(|e| Error::from_reason(e.to_string()))?;

        Ok(Self {
            inner: Arc::new(RwLock::new(index)),
            dim,
            bit_width,
        })
    }

    #[napi]
    pub async fn add_with_ids(&self, vectors: Float32Array, ids: BigUint64Array) -> Result<()> {
        let data = vectors.to_vec();
        let ids = ids.to_vec();
        let dim = self.dim as usize;
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let mut index = inner
                .write()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            index
                .add_with_ids_2d(&data, dim, &ids)
                .map_err(|e| Error::from_reason(e.to_string()))?;
            Ok(())
        })
        .await
        .map_err(|e| Error::from_reason(format!("native add failed: {e}")))??;

        Ok(())
    }

    #[napi]
    pub async fn remove(&self, id: BigInt) -> Result<bool> {
        let id = bigint_to_u64(id)?;
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<bool> {
            let mut index = inner
                .write()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            Ok(index.remove(id))
        })
        .await
        .map_err(|e| Error::from_reason(format!("native remove failed: {e}")))?
    }

    #[napi]
    pub fn contains(&self, id: BigInt) -> Result<bool> {
        let id = bigint_to_u64(id)?;
        let index = self
            .inner
            .read()
            .map_err(|_| Error::from_reason("index lock poisoned"))?;
        Ok(index.contains(id))
    }

    #[napi]
    pub async fn search(
        &self,
        queries: Float32Array,
        k: u32,
        allowlist: Option<BigUint64Array>,
    ) -> Result<IdSearchResult> {
        let data = queries.to_vec();
        let allowlist = allowlist.map(|ids| ids.to_vec());
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<IdSearchResult> {
            let index = inner
                .read()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            let results = index
                .try_search_with_allowlist(&data, k as usize, allowlist.as_deref())
                .map_err(|e| Error::from_reason(e.to_string()))?;

            Ok(IdSearchResult {
                scores: results.scores.into(),
                ids: results.ids.into(),
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

    fn from_core(index: turbovec_core::IdMapIndex) -> Result<Self> {
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

    #[napi(factory)]
    pub fn from_bytes(data: Buffer) -> Result<Self> {
        let index = turbovec_core::IdMapIndex::from_bytes(&data)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Self::from_core(index)
    }

    #[napi(factory)]
    pub async fn load(path: String) -> Result<Self> {
        napi::tokio::task::spawn_blocking(move || -> Result<Self> {
            let index = turbovec_core::IdMapIndex::load(path)
                .map_err(|e| Error::from_reason(e.to_string()))?;
            Self::from_core(index)
        })
        .await
        .map_err(|e| Error::from_reason(format!("native load failed: {e}")))?
    }

    #[napi]
    pub async fn write(&self, path: String, durable: Option<bool>) -> Result<()> {
        let inner = Arc::clone(&self.inner);
        let durability = match durable.unwrap_or(true) {
            true => Durability::Durable,
            false => Durability::Fast,
        };

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let index = inner
                .read()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            index
                .write_with_durability(path, durability)
                .map_err(|e| Error::from_reason(e.to_string()))
        })
        .await
        .map_err(|e| Error::from_reason(format!("native write failed: {e}")))?
    }

    #[napi]
    pub async fn sync(&self, path: String) -> Result<()> {
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let mut index = inner
                .write()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            index
                .sync(path)
                .map_err(|e| Error::from_reason(e.to_string()))
        })
        .await
        .map_err(|e| Error::from_reason(format!("native sync failed: {e}")))?
    }

    #[napi]
    pub async fn calibrate(&self, sample: Float32Array) -> Result<()> {
        let data = sample.to_vec();
        let dim = self.dim as usize;
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let mut index = inner
                .write()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            index
                .calibrate_2d(&data, dim)
                .map_err(|e| Error::from_reason(e.to_string()))
        })
        .await
        .map_err(|e| Error::from_reason(format!("native calibrate failed: {e}")))?
    }

    #[napi]
    pub async fn prepare(&self) -> Result<()> {
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let index = inner
                .read()
                .map_err(|_| Error::from_reason("index lock poisoned"))?;
            index.prepare();
            Ok(())
        })
        .await
        .map_err(|e| Error::from_reason(format!("native prepare failed: {e}")))?
    }

    #[napi(getter)]
    pub fn calibration_state(&self) -> Result<String> {
        let index = self
            .inner
            .read()
            .map_err(|_| Error::from_reason("index lock poisoned"))?;
        Ok(match index.calibration_state() {
            CalibrationState::Uncalibrated => "uncalibrated",
            CalibrationState::Calibrated => "calibrated",
            _ => "unknown",
        }
        .to_string())
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
