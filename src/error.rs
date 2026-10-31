use std::error::Error;
use std::fmt;
use std::io;

/// Stable categories for service errors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    Disposed,
    Locked,
    InvalidInput,
    Io,
    Native,
    Unsupported,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disposed => "ERR_TURBOVEC_DISPOSED",
            Self::Locked => "ERR_TURBOVEC_LOCKED",
            Self::InvalidInput => "ERR_TURBOVEC_INVALID_INPUT",
            Self::Io => "ERR_TURBOVEC_IO",
            Self::Native => "ERR_TURBOVEC_NATIVE",
            Self::Unsupported => "ERR_TURBOVEC_UNSUPPORTED",
        }
    }
}

/// Error returned by [`crate::Service`].
#[derive(Debug)]
pub struct ServiceError {
    code: ErrorCode,
    message: String,
    source: Option<Box<dyn Error + Send + Sync>>,
}

impl ServiceError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    pub fn with_source(
        code: ErrorCode,
        message: impl Into<String>,
        source: impl Error + Send + Sync + 'static,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }

    pub fn code(&self) -> ErrorCode {
        self.code
    }

    pub(crate) fn disposed() -> Self {
        Self::new(ErrorCode::Disposed, "service has been closed")
    }

    pub(crate) fn locked() -> Self {
        Self::new(ErrorCode::Locked, "service lock is poisoned")
    }

    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidInput, message)
    }

    pub(crate) fn unsupported(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unsupported, message)
    }

    pub(crate) fn native(error: impl fmt::Display) -> Self {
        Self::new(ErrorCode::Native, error.to_string())
    }
}

impl fmt::Display for ServiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl Error for ServiceError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.source.as_deref().map(|error| error as _)
    }
}

impl From<io::Error> for ServiceError {
    fn from(error: io::Error) -> Self {
        Self::with_source(ErrorCode::Io, error.to_string(), error)
    }
}
