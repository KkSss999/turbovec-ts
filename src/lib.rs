use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
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

#[derive(Default)]
struct CountingWriter {
    len: usize,
}

impl Write for CountingWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.len = self.len.saturating_add(buf.len());
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

fn create_checkpoint_tmp(path: &Path) -> std::io::Result<(File, PathBuf)> {
    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let name = path.file_name().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no file name")
    })?;

    let mut last_error = None;
    for _ in 0..8 {
        let sequence = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let mut tmp_name = OsString::from(name);
        tmp_name.push(format!(".tmp.{}.{sequence}", std::process::id()));
        let tmp = parent.join(tmp_name);
        match OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(file) => return Ok((file, tmp)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                last_error = Some(error);
            }
            Err(error) => return Err(error),
        }
    }

    Err(last_error.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::AlreadyExists, "could not create temp file")
    }))
}

#[cfg(windows)]
fn move_file_write_through(tmp: &Path, path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let tmp: Vec<u16> = tmp.as_os_str().encode_wide().chain(Some(0)).collect();
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        MoveFileExW(
            tmp.as_ptr(),
            path.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn rename_checkpoint(tmp: &Path, path: &Path) -> std::io::Result<()> {
    let mut delay_ms = 1u64;
    for _ in 0..10 {
        match move_file_write_through(tmp, path) {
            Err(error) if matches!(error.raw_os_error(), Some(5) | Some(32)) => {
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                delay_ms = (delay_ms * 2).min(64);
            }
            result => return result,
        }
    }
    move_file_write_through(tmp, path)
}

#[cfg(not(windows))]
fn rename_checkpoint(tmp: &Path, path: &Path) -> std::io::Result<()> {
    std::fs::rename(tmp, path)
}

fn sweep_stale_tmps(path: &Path) {
    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let Some(base) = path.file_name().and_then(|name| name.to_str()) else {
        return;
    };
    let prefix = format!("{base}.tmp.");
    let now = SystemTime::now();
    let Ok(entries) = std::fs::read_dir(parent) else {
        return;
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(suffix) = name.strip_prefix(&prefix) else {
            continue;
        };
        let mut parts = suffix.split('.');
        let (Some(pid), Some(sequence), None) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        if !pid.bytes().all(|byte| byte.is_ascii_digit())
            || !sequence.bytes().all(|byte| byte.is_ascii_digit())
        {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let stale = metadata.is_file()
            && metadata
                .modified()
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age > Duration::from_secs(60 * 60));
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn sync_checkpoint_parent(parent: &Path) -> Option<String> {
    #[cfg(unix)]
    {
        if let Err(error) = File::open(parent).and_then(|directory| directory.sync_all()) {
            return Some(format!(
                "checkpoint committed, but parent directory fsync failed: {error}; the rename may not survive power loss"
            ));
        }
    }
    #[cfg(not(unix))]
    let _ = parent;
    None
}

fn checkpoint_to_file<F>(path: &Path, durable: bool, write: F) -> Result<Option<String>>
where
    F: FnOnce(&mut File) -> Result<()>,
{
    sweep_stale_tmps(path);
    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let (file, tmp) = create_checkpoint_tmp(path).map_err(|e| io_error(e.to_string()))?;
    let mut file = Some(file);

    let result = (|| -> Result<()> {
        let file = file.as_mut().expect("checkpoint file is open");
        write(file)?;
        if durable {
            file.sync_all().map_err(|e| io_error(e.to_string()))?;
        }
        Ok(())
    })();
    drop(file.take());

    if let Err(error) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(error);
    }

    rename_checkpoint(&tmp, path).map_err(|e| io_error(e.to_string()))?;
    if durable {
        Ok(sync_checkpoint_parent(parent))
    } else {
        Ok(None)
    }
}


fn estimated_bytes(dim: usize, bit_width: usize, n: usize, with_ids: bool) -> f64 {
    let codes_per_byte = 8 / bit_width;
    let n_byte_groups = dim / codes_per_byte;
    let n_blocks = n.saturating_add(31) / 32;
    let codes = n_blocks
        .saturating_mul(n_byte_groups)
        .saturating_mul(32);
    let scales = n.saturating_mul(4);
    let calibration = dim.saturating_mul(4).saturating_mul(2);
    let ids = if with_ids { n.saturating_mul(8) } else { 0 };
    codes
        .saturating_add(scales)
        .saturating_add(calibration)
        .saturating_add(ids)
        .saturating_add(4096) as f64
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
    accounted_bytes: AtomicI64,
    last_warning: Arc<RwLock<Option<String>>>,
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
            accounted_bytes: AtomicI64::new(0),
            last_warning: Arc::new(RwLock::new(None)),
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
            accounted_bytes: AtomicI64::new(0),
            last_warning: Arc::new(RwLock::new(None)),
        })
    }

    #[napi]
    pub async fn add(&self, vectors: Float32Array) -> Result<()> {
        let dim = self.dim as usize;
        if vectors.len() % dim != 0 {
            return Err(err(
                ErrorCode::InvalidInput,
                "vectors length must be a multiple of dim",
            ));
        }
        let data = vectors.to_vec();
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
    pub async fn swap_remove(&self, idx: u32) -> Result<u32> {
        let inner = Arc::clone(&self.inner);

        napi::tokio::task::spawn_blocking(move || -> Result<u32> {
            let mut guard = inner.write().map_err(|_| lock_error())?;
            let index = guard.as_mut().ok_or_else(disposed)?;
            let idx = idx as usize;
            if idx >= index.len() {
                return Err(err(
                    ErrorCode::InvalidInput,
                    format!("slot {idx} out of range for length {}", index.len()),
                ));
            }
            u32::try_from(index.swap_remove(idx))
                .map_err(|_| err(ErrorCode::Native, "slot exceeds u32"))
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
    pub async fn checkpoint(&self, path: String, durable: Option<bool>) -> Result<()> {
        let inner = Arc::clone(&self.inner);
        let last_warning = Arc::clone(&self.last_warning);
        let durable = durable.unwrap_or(true);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let warning = checkpoint_to_file(Path::new(&path), durable, |file| {
                let guard = inner.read().map_err(|_| lock_error())?;
                let index = guard.as_ref().ok_or_else(disposed)?;
                index
                    .write_to_writer(file)
                    .map_err(|e| io_error(e.to_string()))
            })?;
            *last_warning.write().map_err(|_| lock_error())? = warning;
            Ok(())
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub fn clear(&self, env: Env) -> Result<()> {
        let fresh = TurboCore::new(self.dim as usize, self.bit_width as usize)
            .map_err(|e| native_error(e.to_string()))?;
        {
            let mut guard = self.inner.write().map_err(|_| lock_error())?;
            *guard = Some(fresh);
        }
        self.sync_external_memory(env)
    }

    #[napi(getter)]
    pub fn serialized_length(&self) -> Result<f64> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        Ok(guard.as_ref().map_or(0.0, |index| index.serialized_len() as f64))
    }

    #[napi]
    pub fn sync_external_memory(&self, env: Env) -> Result<()> {
        let current = {
            let guard = self.inner.read().map_err(|_| lock_error())?;
            let Some(index) = guard.as_ref() else {
                return self.adjust_accounted(env, 0);
            };
            estimated_bytes(
                self.dim as usize,
                self.bit_width as usize,
                index.len(),
                false,
            ) as i64
        };
        self.adjust_accounted(env, current)
    }

    fn adjust_accounted(&self, env: Env, current: i64) -> Result<()> {
        let previous = self.accounted_bytes.swap(current, Ordering::Relaxed);
        let delta = current - previous;
        if delta == 0 {
            return Ok(());
        }
        if let Err(error) = env.adjust_external_memory(delta) {
            self.accounted_bytes.store(previous, Ordering::Relaxed);
            return Err(native_error(error.to_string()));
        }
        Ok(())
    }

    #[napi]
    pub fn dispose(&self, env: Env) -> Result<()> {
        {
            let mut guard = self.inner.write().map_err(|_| lock_error())?;
            *guard = None;
        }
        self.sync_external_memory(env)
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
    pub fn is_disposed(&self) -> Result<bool> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        Ok(guard.is_none())
    }

    #[napi(getter)]
    pub fn last_warning(&self) -> Result<Option<String>> {
        Ok(self
            .last_warning
            .read()
            .map_err(|_| lock_error())?
            .clone())
    }

    #[napi(getter)]
    pub fn estimated_bytes(&self) -> Result<f64> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        let Some(index) = guard.as_ref() else {
            return Ok(0.0);
        };
        Ok(estimated_bytes(
            self.dim as usize,
            self.bit_width as usize,
            index.len(),
            false,
        ))
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
    accounted_bytes: AtomicI64,
    last_warning: Arc<RwLock<Option<String>>>,
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
            accounted_bytes: AtomicI64::new(0),
            last_warning: Arc::new(RwLock::new(None)),
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
            accounted_bytes: AtomicI64::new(0),
            last_warning: Arc::new(RwLock::new(None)),
        })
    }

    #[napi]
    pub async fn add_with_ids(&self, vectors: Float32Array, ids: BigUint64Array) -> Result<()> {
        let dim = self.dim as usize;
        if vectors.len() % dim != 0 {
            return Err(err(
                ErrorCode::InvalidInput,
                "vectors length must be a multiple of dim",
            ));
        }
        let rows = vectors.len() / dim;
        if ids.len() != rows {
            return Err(err(
                ErrorCode::InvalidInput,
                format!("expected {rows} ids, got {}", ids.len()),
            ));
        }
        let data = vectors.to_vec();
        let ids = ids.to_vec();
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
    pub fn iter_ids(&self) -> Result<BigUint64Array> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        let index = guard.as_ref().ok_or_else(disposed)?;
        Ok(index.iter_ids().collect::<Vec<u64>>().into())
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
    pub async fn checkpoint(&self, path: String, durable: Option<bool>) -> Result<()> {
        let inner = Arc::clone(&self.inner);
        let last_warning = Arc::clone(&self.last_warning);
        let durable = durable.unwrap_or(true);

        napi::tokio::task::spawn_blocking(move || -> Result<()> {
            let warning = checkpoint_to_file(Path::new(&path), durable, |file| {
                let guard = inner.read().map_err(|_| lock_error())?;
                let index = guard.as_ref().ok_or_else(disposed)?;
                index
                    .write_to_writer(file)
                    .map_err(|e| io_error(e.to_string()))
            })?;
            *last_warning.write().map_err(|_| lock_error())? = warning;
            Ok(())
        })
        .await
        .map_err(task_error)?
    }

    #[napi]
    pub fn clear(&self, env: Env) -> Result<()> {
        let fresh = IdCore::new(self.dim as usize, self.bit_width as usize)
            .map_err(|e| native_error(e.to_string()))?;
        {
            let mut guard = self.inner.write().map_err(|_| lock_error())?;
            *guard = Some(fresh);
        }
        self.sync_external_memory(env)
    }

    #[napi(getter)]
    pub fn serialized_length(&self) -> Result<f64> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        let Some(index) = guard.as_ref() else {
            return Ok(0.0);
        };
        let mut counter = CountingWriter::default();
        index
            .write_to_writer(&mut counter)
            .map_err(|e| io_error(e.to_string()))?;
        Ok(counter.len as f64)
    }

    #[napi]
    pub fn sync_external_memory(&self, env: Env) -> Result<()> {
        let current = {
            let guard = self.inner.read().map_err(|_| lock_error())?;
            let Some(index) = guard.as_ref() else {
                return self.adjust_accounted(env, 0);
            };
            estimated_bytes(
                self.dim as usize,
                self.bit_width as usize,
                index.len(),
                true,
            ) as i64
        };
        self.adjust_accounted(env, current)
    }

    fn adjust_accounted(&self, env: Env, current: i64) -> Result<()> {
        let previous = self.accounted_bytes.swap(current, Ordering::Relaxed);
        let delta = current - previous;
        if delta == 0 {
            return Ok(());
        }
        if let Err(error) = env.adjust_external_memory(delta) {
            self.accounted_bytes.store(previous, Ordering::Relaxed);
            return Err(native_error(error.to_string()));
        }
        Ok(())
    }

    #[napi]
    pub fn dispose(&self, env: Env) -> Result<()> {
        {
            let mut guard = self.inner.write().map_err(|_| lock_error())?;
            *guard = None;
        }
        self.sync_external_memory(env)
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
    pub fn is_disposed(&self) -> Result<bool> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        Ok(guard.is_none())
    }

    #[napi(getter)]
    pub fn last_warning(&self) -> Result<Option<String>> {
        Ok(self
            .last_warning
            .read()
            .map_err(|_| lock_error())?
            .clone())
    }

    #[napi(getter)]
    pub fn estimated_bytes(&self) -> Result<f64> {
        let guard = self.inner.read().map_err(|_| lock_error())?;
        let Some(index) = guard.as_ref() else {
            return Ok(0.0);
        };
        Ok(estimated_bytes(
            self.dim as usize,
            self.bit_width as usize,
            index.len(),
            true,
        ))
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
