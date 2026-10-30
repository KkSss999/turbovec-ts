# Sync lock decision

## Question

Should `sync()` move behind a write queue instead of taking the index write lock?

## Constraint

The core API is:

```rust
pub fn sync(&mut self, path: &Path) -> io::Result<()>
```

It advances an internal commit cursor and writes the new container state. It needs exclusive
mutable access for the whole call. The binding wraps the core index in
`Arc<RwLock<Option<Core>>>`, so `sync()` must hold the write lock.

## Options considered

| Option              | Effect                                                   | Cost                                                                                 |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Write queue         | Serializes sync requests; one sync waits for another     | Does not let searches run during the active sync                                     |
| Snapshot/checkpoint | Copy bytes under read lock, release, then write the file | Full-file write, loses incremental sync semantics; needs its own atomic/fsync writer |
| Core change         | Add a core API that snapshots or commits without `&mut`  | Upstream change and format-level testing                                             |
| Keep exclusive sync | Searches and mutations wait during sync                  | Simple and matches the core contract                                                 |

## Decision

Keep `sync()` exclusive. A write queue only changes which writer waits, not whether searches
block, so it adds machinery without solving the user-visible pause.

Use `write()` when a full snapshot is acceptable: it takes the read lock, so searches continue
while the snapshot is written, but mutations wait. Use `sync()` when incremental durability is
required and the exclusive pause is acceptable.

Revisit this if profiling shows sync pauses matter in a real workload. The likely next step is a
snapshot-based `checkpoint(path)` with its own durable file writer, not a queue.
