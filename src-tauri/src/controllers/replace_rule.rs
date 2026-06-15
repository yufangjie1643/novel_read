use rusqlite::{Connection, Result};

use crate::db::{
    ReplaceRuleDao,
    models::{ReplaceRule, RuleMatchMeta},
};

pub fn list_all(conn: &Connection) -> Result<Vec<ReplaceRule>> {
    ReplaceRuleDao::new(conn).get_all()
}

pub fn get(conn: &Connection, id: i64) -> Result<Option<ReplaceRule>> {
    ReplaceRuleDao::new(conn).get(id)
}

pub fn insert(conn: &Connection, rule: &ReplaceRule) -> Result<i64> {
    ReplaceRuleDao::new(conn).insert(rule)
}

pub fn insert_many(conn: &Connection, rules: &[ReplaceRule]) -> Result<usize> {
    ReplaceRuleDao::new(conn).insert_many(rules)
}

pub fn update(conn: &Connection, rule: &ReplaceRule) -> Result<()> {
    ReplaceRuleDao::new(conn).update(rule)
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    ReplaceRuleDao::new(conn).delete(id)
}

/// Apply a single rule to text and return match metadata. Pure helper —
/// does not touch the DB.
pub fn test_rule(rule: &ReplaceRule, text: &str) -> RuleMatchMeta {
    crate::content_processor::apply_single_rule(text, rule)
}
