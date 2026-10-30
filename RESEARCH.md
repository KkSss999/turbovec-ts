# turbovec-node 可行性与方案调研

日期：2026-10-31  
目标：为 Electron / Node.js 项目提供 turbovec 的 TypeScript SDK。

## 1. 结论

可行，推荐路线是 **napi-rs v3 + Node-API**，为 `turbovec` Rust core 增加一层
Node 原生插件，再提供 TypeScript 包装。

不建议第一版做 WASM。浏览器/Edge 需要重写 32 位、文件系统、线程和 SIMD 相关部分，
与 Node 原生 SDK 是两个项目。

## 2. 关键调研结果

### 2.1 工具链版本

- 本机：Node v24.21.0、npm 11.19.0、pnpm 12.15.0、Rust 1.99.1。
- `@napi-rs/cli` 当前为 3.x（npm 上 3.10.9），要求 Node
  `^20.17.0 || ^22.13.0 || >=23.5.0`，Rust 1.88+。
- `napi` crate 当前 3.x（crates.io 3.16.0）。
- turbovec core 要求 Rust 1.89+、64-bit target。
- 结论：当前开发机满足全部要求。

来源：

- https://napi.rs/docs/introduction/getting-started
- https://napi.rs/docs/more/support-compatibility
- https://crates.io/crates/napi

### 2.2 Node-API 与 Electron

- Node-API 提供跨 Node.js 版本的 ABI 稳定性；按 Node-API level N 编译的插件，
  通常可以在提供 level N 的后续 Node.js 上加载，不需要按 Node 大版本重编译。
- 但 ABI 稳定不覆盖 OS、CPU、libc、C++ runtime、最低系统版本。
- Electron 的整体 ABI 与 Node 不同，普通 V8 addon 需要 rebuild；Node-API 插件
  通常可以避免按 Electron 版本重编译，但仍必须在目标 Electron 版本上验证。
- 建议选择 Node-API 8（`napi8`）：
  - `BigInt` / `BigUint64Array` 需要 `napi6`。
  - async 支持需要 `napi4`。
  - Electron 38/39 使用 Node 22.18/22.20，提供足够高的 Node-API level。
  - 运行时用 `process.versions.napi` 确认。
- `napi-rs` 官方建议 Electron 中优先在主进程或 preload 加载，暴露窄 IPC；
  不要在开启 unrestricted Node integration 的 renderer 中加载。
- 打包时必须把 `.node` 放在 ASAR 外（`asarUnpack`），并保留 optional platform
  packages 在生产依赖中。
- 必须在打包后的产物上测试 reload、shutdown、每种 Electron 架构。

来源：

- https://napi.rs/docs/more/support-compatibility
- https://napi.rs/docs/more/integrations
- https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- https://www.electronjs.org/docs/latest/tutorial/electron-timelines

### 2.3 异步与 CPU 密集任务

- JS 线程不能执行长时间同步搜索，否则阻塞事件循环。
- napi-rs 提供：
  - `#[napi] async fn`：Tokio runtime，适合异步 I/O。
  - `AsyncTask<T>`：libuv 线程池，适合阻塞/CPU 工作。
  - `tokio::task::spawn_blocking`：在 async fn 中隔离 CPU 工作。
- `AsyncTask::with_signal` 只能取消尚未开始的任务；已经开始的计算无法中断。
- libuv 线程池与 fs/DNS/crypto 共享，不能让大量长任务淹没它；需要限制并发或使用
  专用 Rust 线程池。
- 建议：搜索/写入/落盘提供 async API，内部用 `AsyncTask` 或 `spawn_blocking`；
  同步 API 仅用于 Worker/CLI。

来源：

- https://napi.rs/docs/more/async-concurrency
- https://napi.rs/docs/concepts/async-task

### 2.4 TypedArray、BigInt 与 Electron 的零拷贝限制

- `Float32Array`、`BigUint64Array` 可直接映射到 Rust typed array。
- Rust `u64` 输出映射为 JS `bigint`；BigInt typed array 需要 `napi6`。
- 输入 u64 应使用 `BigInt` wrapper 并检查 `get_u64()` 的 lossless 标志，避免静默截断。
- **Electron 中 Buffer 不能零拷贝创建**（V8 memory cage），napi-rs 会退化为复制。
  这意味着 `toBytes()`、大 batch 输入输出在 Electron 里会有额外拷贝成本，需要
  基准测试和 API 设计规避。
- 异步调用跨线程时，JS buffer 生命周期不能保证，通常需要先 `to_vec()` 复制。

来源：

- https://napi.rs/docs/concepts/typed-array
- https://napi.rs/docs/concepts/type-conversions

### 2.5 分发模型

- napi-rs 采用“根包 + 每个平台一个 optional package”：
  - `@scope/turbovec`
  - `@scope/turbovec-linux-x64-gnu`
  - `@scope/turbovec-darwin-arm64`
  - `@scope/turbovec-win32-x64-msvc`
- 平台包声明 `os`、`cpu`、`libc`；根包在 `optionalDependencies` 中列精确版本。
- 发布流程：`napi create-npm-dirs` → `napi build` → `napi artifacts` →
  `napi pre-publish` → `npm publish`。
- 建议保持生成 loader 在 bundle 外，bundler 将原生包 externalize。
- 需要同时测试 CJS `require()` 和 ESM `import`。

来源：

- https://napi.rs/docs/deep-dive/release
- https://napi.rs/docs/more/integrations
- https://napi.rs/docs/cli/create-npm-dirs

### 2.6 已有先例与包名

- npm 上已存在 `turbovec-node@0.1.1`（2026-06 发布，维护者 amubhya，
  仓库 ridwanmubarok/turbovec-node）：
  - 使用 napi-rs 2.x。
  - API 较简单，`addWithIds(vectors, dim, ids)`、同步 `search(queries, dim, k, ...)`。
  - 没有看到完整的 async、Electron 打包、预编译矩阵、Python 互操作测试。
- `turbovec` 和 `@turbovec/node` 在 npm 上暂未发现。
- 建议使用 scoped 包名，避免与已有 `turbovec-node` 冲突，例如
  `@yourorg/turbovec` 或 `@turbovec/node`（需确认组织名/scope 可用）。

来源：

- https://www.npmjs.com/package/turbovec-node
- https://github.com/ridwanmubarok/turbovec-node

### 2.7 本仓库构建细节

- `turbovec` core 的 `.cargo/config.toml` 将 x86_64 基线设为 `x86-64-v2`。
  独立在 `turbovec-node` 构建时不会自动继承该配置，需要复制等价配置，避免
  x86 兼容性或性能差异。
- `turbovec` core 明确只支持 64 位 target；Node/Electron 64 位满足。
- core 的 `write()` / `sync()` 是阻塞文件 I/O，应放到 async task。
- core 的 `search(&self)` 可并发，`add`/`remove` 需要 `&mut self`，Node 侧用
  `Arc<RwLock<...>>` 包一层。

## 2.8 已确认的工具链与目标（2026-10-31）

- 包名：`turbovec-ts`（npm 上暂未发现同名包）。
- 包管理器：**Bun**（`bun install` / `bunx` / `bun test`）。
- Lint + 类型检查：**oxlint**。类型检查用
  `oxlint --type-aware --type-check`，依赖 `oxlint-tsgolint`。
- 格式化：**oxfmt**。
- 不使用 ESLint、Prettier，也不把 `tsc --noEmit` 作为主检查。
- 目标平台：Linux x64/arm64、macOS x64/arm64、Windows x64/arm64。
- 本地机器只覆盖 Linux x64、Windows x64、macOS arm64；其余三个目标必须
  在 CI/租用原生硬件上构建并做加载冒烟测试，未测试前不得声称支持。
- `AGENTS.md` 仅本地使用，已加入 `.gitignore`，不提交、不同步。

参考：

- https://oxc.rs/docs/guide/usage/linter/type-aware
- https://oxc.rs/docs/guide/usage/formatter/config.html

## 3. 推荐架构

```text
Electron Renderer
      │ narrow IPC
      ▼
Main process / utilityProcess
      │
      ▼
turbovec-node native addon (.node)
      │  Arc<RwLock<turbovec::TurboQuantIndex>>
      │  AsyncTask / spawn_blocking
      ▼
turbovec Rust core
```

- **Node 后端 / CLI**：可直接在主线程外通过 async API 使用。
- **Electron**：索引由 `utilityProcess` 或专用 Worker 持有，renderer 只通过 IPC
  调用；避免 UI 卡顿和原生崩溃带崩整个应用。
- **同步 API**：保留给 Worker/CLI，不推荐在主进程使用。
- **第一版不做 WASM**。

## 4. 分阶段计划

### Phase 0：决策（0.5 天）

需要确认：

1. 目标 Electron 版本范围 / Node 版本范围。
2. 目标平台：linux x64/arm64、macOS x64/arm64、Windows x64/arm64？
3. npm 包名/scope：内部包还是公开发布？
4. 是否第一版就支持 `sync()` / `write()` / `load()`。
5. 是否接受 `bigint` 作为 id 类型；是否需要同时提供 string id 包装。
6. 是否需要 Bun/Deno 支持（不作为第一版承诺）。

### Phase 1：脚手架（1–2 天）

- 创建 `turbovec-node` napi-rs v3 工程。
- `Cargo.toml`：`cdylib`、`napi = { version = "3", features = ["napi8", "async"] }`、
  `turbovec-core` path/版本依赖。
- `build.rs`：`napi_build::setup()`。
- `package.json`：`binaryName`、`napi.targets`、`@napi-rs/cli`。
- 复制 x86_64 `x86-64-v2` 配置。
- 编译并跑通 `TurboQuantIndex` 最小 add/search。

### Phase 2：核心 Binding（约 1–2 周）

- `TurboQuantIndex`：
  - constructor(dim?, bitWidth?)
  - `add` / `addSync`
  - `search` / `searchSync`
  - `calibrate`
  - `prepare`
  - `write` / `sync` / `load`
  - `toBytes` / `fromBytes`
  - `swapRemove`
  - `dispose`
  - `dim` / `bitWidth` / `length` / `calibrationState`
- `IdMapIndex`：
  - `addWithIds`
  - `remove` / `contains`
  - `search` with `allowlist`
  - 持久化方法
- 错误类型映射、panic 边界、内存核算。
- `Arc<RwLock<...>>` + async task，限制并发数。
- BigInt/BigUint64Array 严格校验。

### Phase 3：格式互操作与测试（约 1 周）

- Python `write()` 文件 → Node `load()`。
- Node `write()` 文件 → Python `load()`。
- golden fixture / 版本兼容。
- 大 id（2^53+1、2^64-1）。
- 多维、2/3/4-bit、空索引、duplicate id、allowlist。
- async 并发、worker threads、进程退出。

### Phase 4：Electron 集成（约 1 周）

- `utilityProcess` 常驻索引服务。
- MessageChannel / postMessage 协议。
- `asarUnpack`、optional platform packages。
- 打包产物 smoke test：reload、shutdown、多架构。
- macOS 签名/公证；Windows MSVC runtime；Linux glibc 基线。
- 测试是否需要在目标 Electron 上 rebuild（预期不需要，但必须验证）。

### Phase 5：CI 与预编译发布（约 1–2 周）

- GitHub Actions 矩阵：
  - linux x64/arm64 gnu；可选 musl。
  - macOS x64/arm64（考虑 universal）。
  - Windows x64/arm64。
- `napi create-npm-dirs` / `artifacts` / `pre-publish`。
- CJS + ESM 双入口。
- npm provenance / 签名。
- 运行时 `process.versions.napi` 检查与清晰报错。

### Phase 6：性能与优化（持续）

- 测量 JS↔Rust 拷贝成本，尤其是 Electron 的 Buffer 拷贝。
- 对比 Node 同步/异步、单查询/批查询。
- 调整 rayon 线程数与 libuv 并发，避免过度订阅。
- 评估是否需要外部 buffer / 分块传输 / 共享内存方案。

## 5. 主要风险

1. Electron 无法零拷贝 Buffer，`toBytes()` 和大批量数据可能明显复制。
2. libuv 线程池被 CPU 搜索占满，影响 fs/DNS 等；需要并发上限或专用线程池。
3. 搜索无法真正取消；`AbortSignal` 只能取消未开始任务。
4. 原生崩溃会终止进程；Electron 应放到 utilityProcess 隔离。
5. ASAR 打包、签名、公证、多架构是实际交付的主要工作量。
6. u64 id 的 `bigint` 人体工学与 JSON 序列化问题。
7. 独立构建不会继承 core 的 `.cargo/config.toml`，需复制 x86-64-v2 配置。
8. npm 包名 `turbovec-node` 已被占用，应使用 scope 或新名称。
9. 现有 core 是 64 位 only；不支持 32 位 Node/Electron。
10. 版本兼容：core 的 v8 文件格式与旧版本不互通，binding 版本需与 core 锁定。

## 6. 待确认问题

- Electron 目标版本？
- 目标 OS/CPU 矩阵？
- 包名/scope？
- 是否需要公开发布 npm？
- 第一版是否需要完整 `sync()`/`write()`/`load()`？
- 索引规模、查询延迟目标？
- 是否使用 utilityProcess 架构？
