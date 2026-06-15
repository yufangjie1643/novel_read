use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand_core::OsRng;
use rusqlite::{Connection, Result};

use crate::db::{HttpServerAuthDao, models::HttpServerAuth};

pub fn get(conn: &Connection) -> Result<Option<HttpServerAuth>> {
    HttpServerAuthDao::new(conn).get()
}

pub fn clear(conn: &Connection) -> Result<()> {
    HttpServerAuthDao::new(conn).clear()
}

/// Hash `password` with argon2's default algorithm and a fresh random salt,
/// then store the resulting PHC string alongside `username`.
pub fn set(conn: &Connection, username: &str, password: &str) -> Result<()> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(
                format!("argon2 hash error: {e}").into(),
            )
        })?
        .to_string();
    let auth = HttpServerAuth {
        username: username.to_string(),
        password_hash: hash,
        updated_at: chrono::Utc::now().timestamp_millis(),
    };
    HttpServerAuthDao::new(conn).set(&auth)
}

/// Verify a candidate `(username, password)` pair against the stored hash.
/// Returns `false` if no credential row exists, if the username mismatches,
/// or if the password fails argon2 verification.
pub fn verify(conn: &Connection, username: &str, password: &str) -> Result<bool> {
    let Some(auth) = HttpServerAuthDao::new(conn).get()? else {
        return Ok(false);
    };
    if auth.username != username {
        return Ok(false);
    }
    let Ok(parsed) = PasswordHash::new(&auth.password_hash) else {
        return Ok(false);
    };
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}
