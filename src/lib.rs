use std::sync::{Arc, RwLock};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use turbovec_core::io::Durability;
use turbovec_core::CalibrationState;

#[derive(Debug, Clone, Copy)]
enum ErrorCode {
    Disposed,
    Locked,
    InvalidInput,
    Io,
    Native,
    Unsupported,
    Task,
}

impl AsRef<str> for ErrorCode {
    fn as_ref(&self) -> &'static str {
        match self {
            Self::Disposed => "ERR_TURBOVEC_DISPOSED",
            Self::Locked => "ERR_TURBOVEC_LOCKED",
            Self::InvalidInput => "ERR_TURBOVEC_INVALID_INPUT",
            Self::Io => "ERR_TURBOVEC_IO",
            Self::Native => "ERR_TURBOVEC_NATIVE",
            Self::Unsupported => "ERR_TURBOVEC_UNSUPPORTED",
            Self::Task => "ERR_TURBOVEC_TASK",
        }
    }
}

fn err(code: ErrorCode, message: impl ToString) -> Error {
    Error::new(
        Status::GenericFailure,
        format!("{}: {}", code.as_ref(), message.to_string()),
    )
}

fn disposed() -> Error {
    err(ErrorCode::Disposed, "index has been disposed")
}

fn lock_error() -> Error {
    err(ErrorCode::Locked, "index lock poisoned")
}

fn native_error(message: impl ToString) -> Error {
    err(ErrorCode::Native, message)
}

fn io_error(message: impl ToString) -> Error {
    err(ErrorCode::Io, message)
}

fn task_error(message: impl ToString) -> Error {
    err(ErrorCode::Task, message)
}

fn bigint_to_u64(value: BigInt) -> Result<u64> {
    let (negative, value, lossless) = value.get_u64();
    if negative || !lossless {
        return Err(err(ErrorCode::InvalidInput, "id must fit in u64"));
    }
    Ok(value)
}

type TurboCore = turbovec_core::TurboQuantIndex;
type TurboHandle = Arc<RwLock<Option<TurboCore>>>;
type IdCore = turbovec_core::IdMapIndex;
type IdHandle = Arc<RwLock<Option<IdCore>>>;

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
    inner: TurboHandle,
    dim: u32,
    bit_width: u32,
}

#[napi]
impl TurboQuantIndex {
    #[napi(constructor)]
    pub fn new(dim: u32, bit_width: Option<u32>) -> Result<Self> {
        let bit_width = bit_width.unwrap_or(4);
        let index = TurboCore::new(dim as usize, bit_width as usize)
            .map_err(|e| native_error(e.to_string()))?;

        Ok(Self {
            inner: Arc::new(RwLock::new(Some(index))),
            dim,
            bit_width,
        })
    }

    fn from_core(index: TurboCore) -> Result<Self> {
        let dim = index
            .dim_opt()
            .ok_or_else(|| err(ErrorCode::Unsupported, "lazy indexes are not supported yet"))?;
        let bit_width = index.bit_width();

        Ok(Self {
            inner: Arc::new(RwLock::new(Some(index))),
            dim: dim as u32,
            bit_width: bit_width as u32,
        })
    }

    #[napi]
    pub async fn add(&self, vectors: Float32Array) -> Result<()> {
        let data = vectors.to_vec();
        let dim = self.dim as usize;
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let mut guard = inner.write().map_err(|_| lock_error())?;
            let index = guard.as_mut().ok_or_else(disposed)?;
            index
                .add_2d(&data, dim)
                .map_err(|e| native_error(e.to_string()))?;
            Ok(())
        })
        .await
        .map_err(task_error)?
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
            let guard = inner.read().map_err(|_| lock_error())?;
            let index = guard.as_ref().ok_or_else(disposed)?;
            let results = index
                .try_search_with_mask(&data, k as usize, mask.as_deref())
                .map_err(|e| native_error(e.to_string()))?;

            Ok(SearchResult {
                scores: results.scores.into(),
                indices: results.indices,
                nq: results.nq as u32,
                k: results.k as u32,
            })
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub fn to_bytes(&self) -> Result<Buffer> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        let index = guard.as_ref().ok_or_else(disposed)?;
        Ok(index.to_bytes().into())
    }

    #[napi(factory)]
    pub fn from_bytes(data: Buffer) -> Result<Self> {
        let index = TurboCore::from_bytes(&data).map_err(|e| native_error(e.to_string()))?;
        Self::from_core(index)
    }

    #[napi(factory)]
    pub async fn load(path: String) -> Result<Self> {
        napi::tokio::task::spawn_blocking(move || -> Result<Self> {
            let index = TurboCore::load(path).map_err(|e| io_error(e.to_string()))?;
            Self::from_core(index)
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub async fn write(&self, path: String, durable: Option<bool>) -> Result<()> {
        let inner = Arc::clone(&self.inner);
        let durability = match durable.unwrap_or(true) {
            true => Durability::Durable,
            false => Durability::Fast,
        };

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let guard = inner.read().map_err(|_| lock_error())?;
            let index = guard.as_ref().ok_or_else(disposed)?;
            index
                .write_with_durability(path, durability)
                .map_err(|e| io_error(e.to_string()))
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub async fn sync(&self, path: String) -> Result<()> {
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let mut guard = inner.write().map_err(|_| lock_error())?;
            let index = guard.as_mut().ok_or_else(disposed)?;
            index.sync(path).map_err(|e| io_error(e.to_string()))
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub async fn calibrate(&self, sample: Float32Array) -> Result<()> {
        let data = sample.to_vec();
        let dim = self.dim as usize;
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let mut guard = inner.write().map_err(|_| lock_error())?;
            let index = guard.as_mut().ok_or_else(disposed)?;
            index
                .calibrate_2d(&data, dim)
                .map_err(|e| native_error(e.to_string()))
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub async fn prepare(&self) -> Result<()> {
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let guard = inner.read().map_err(|_| lock_error())?;
            let index = guard.as_ref().ok_or_else(disposed)?;
            index.prepare();
            Ok(())
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub fn dispose(&self) -> Result<()> {
        let mut guard = self.inner.write().map_err(|_| lock_error())?;
        *guard = None;
        Ok(())
    }

    #[napi(getter)]
    pub fn calibration_state(&self) -> Result<String> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        let index = guard.as_ref().ok_or_else(disposed)?;
        Ok(match index.calibration_state() {
            CalibrationState::Uncalibrated => "uncalibrated",
            CalibrationState::Calibrated => "calibrated",
            _ => "unknown",
        }
        .to_string())
    }

    #[napi(getter)]
    pub fn length(&self) -> Result<u32> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        let index = guard.as_ref().ok_or_else(disposed)?;
        u32::try_from(index.len()).map_err(|_| err(ErrorCode::Native, "length exceeds u32"))
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
    inner: IdHandle,
    dim: u32,
    bit_width: u32,
}

#[napi]
impl IdMapIndex {
    #[napi(constructor)]
    pub fn new(dim: u32, bit_width: Option<u32>) -> Result<Self> {
        let bit_width = bit_width.unwrap_or(4);
        let index = IdCore::new(dim as usize, bit_width as usize)
            .map_err(|e| native_error(e.to_string()))?;

        Ok(Self {
            inner: Arc::new(RwLock::new(Some(index))),
            dim,
            bit_width,
        })
    }

    fn from_core(index: IdCore) -> Result<Self> {
        let dim = index
            .dim_opt()
            .ok_or_else(|| err(ErrorCode::Unsupported, "lazy indexes are not supported yet"))?;
        let bit_width = index.bit_width();

        Ok(Self {
            inner: Arc::new(RwLock::new(Some(index))),
            dim: dim as u32,
            bit_width: bit_width as u32,
        })
    }

    #[napi]
    pub async fn add_with_ids(&self, vectors: Float32Array, ids: BigUint64Array) -> Result<()> {
        let data = vectors.to_vec();
        let ids = ids.to_vec();
        let dim = self.dim as usize;
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let mut guard = inner.write().map_err(|_| lock_error())?;
            let index = guard.as_mut().ok_or_else(disposed)?;
            index
                .add_with_ids_2d(&data, dim, &ids)
                .map_err(|e| native_error(e.to_string()))?;
            Ok(())
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub async fn remove(&self, id: BigInt) -> Result<bool> {
        let id = bigint_to_u64(id)?;
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<bool> {
            let mut guard = inner.write().map_err(|_| lock_error())?;
            let index = guard.as_mut().ok_or_else(disposed)?;
            Ok(index.remove(id))
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub fn contains(&self, id: BigInt) -> Result<bool> {
        let id = bigint_to_u64(id)?;
        let guard = self.inner.read().map_err(|_| lock_error())?;
        let index = guard.as_ref().ok_or_else(disposed)?;
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
            let guard = inner.read().map_err(|_| lock_error())?;
            let index = guard.as_ref().ok_or_else(disposed)?;
            let results = index
                .try_search_with_allowlist(&data, k as usize, allowlist.as_deref())
                .map_err(|e| native_error(e.to_string()))?;

            Ok(IdSearchResult {
                scores: results.scores.into(),
                ids: results.ids.into(),
                nq: results.nq as u32,
                k: results.k as u32,
            })
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub fn to_bytes(&self) -> Result<Buffer> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        let index = guard.as_ref().ok_or_else(disposed)?;
        Ok(index.to_bytes().into())
    }

    #[napi(factory)]
    pub fn from_bytes(data: Buffer) -> Result<Self> {
        let index = IdCore::from_bytes(&data).map_err(|e| native_error(e.to_string()))?;
        Self::from_core(index)
    }

    #[napi(factory)]
    pub async fn load(path: String) -> Result<Self> {
        napi::tokio::task::spawn_blocking(move || -> Result<Self> {
            let index = IdCore::load(path).map_err(|e| io_error(e.to_string()))?;
            Self::from_core(index)
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub async fn write(&self, path: String, durable: Option<bool>) -> Result<()> {
        let inner = Arc::clone(&self.inner);
        let durability = match durable.unwrap_or(true) {
            true => Durability::Durable,
            false => Durability::Fast,
        };

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let guard = inner.read().map_err(|_| lock_error())?;
            let index = guard.as_ref().ok_or_else(disposed)?;
            index
                .write_with_durability(path, durability)
                .map_err(|e| io_error(e.to_string()))
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub async fn sync(&self, path: String) -> Result<()> {
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let mut guard = inner.write().map_err(|_| lock_error())?;
            let index = guard.as_mut().ok_or_else(disposed)?;
            index.sync(path).map_err(|e| io_error(e.to_string()))
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub async fn calibrate(&self, sample: Float32Array) -> Result<()> {
        let data = sample.to_vec();
        let dim = self.dim as usize;
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let mut guard = inner.write().map_err(|_| lock_error())?;
            let index = guard.as_mut().ok_or_else(disposed)?;
            index
                .calibrate_2d(&data, dim)
                .map_err(|e| native_error(e.to_string()))
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub async fn prepare(&self) -> Result<()> {
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let guard = inner.read().map_err(|_| lock_error())?;
            let index = guard.as_ref().ok_or_else(disposed)?;
            index.prepare();
            Ok(())
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub fn dispose(&self) -> Result<()> {
        let mut guard = self.inner.write().map_err(|_| lock_error())?;
        *guard = None;
        Ok(())
    }

    #[napi(getter)]
    pub fn calibration_state(&self) -> Result<String> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        let index = guard.as_ref().ok_or_else(disposed)?;
        Ok(match index.calibration_state() {
            CalibrationState::Uncalibrated => "uncalibrated",
            CalibrationState::Calibrated => "calibrated",
            _ => "unknown",
        }
        .to_string())
    }

    #[napi(getter)]
    pub fn length(&self) -> Result<u32> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        let index = guard.as_ref().ok_or_else(disposed)?;
        u32::try_from(index.len()).map_err(|_| err(ErrorCode::Native, "length exceeds u32"))
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
