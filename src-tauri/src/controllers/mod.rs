//! Thin facades over the DAO layer, mirroring the Android
//! `api/controller/` package (BookSourceController.kt etc.).
//!
//! Each submodule exposes plain `pub fn`s that take `&Connection` and
//! forward to a single DAO method. Commands in `commands.rs` call these
//! inside the `db_op` closure so this layer stays pure and side-effect
//! free at the type level.

pub mod book;
pub mod book_progress;
pub mod book_source;
pub mod http_server_auth;
pub mod replace_rule;
pub mod rss_source;
