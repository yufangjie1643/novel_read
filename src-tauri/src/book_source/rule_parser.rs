//! Rule parser for book source engine
//!
//! Parses rule strings like:
//! - `class.book-list@tag.a.0@text` (CSS selector chain)
//! - `@XPath://div[@class='title']` (XPath)
//! - `$.books[0].title` (JSONPath)
//! - `<js>javascript code</js>` (JS block)
//! - `{{js expression}}` (inline JS)
//! - `##match##replace` (regex replacement)

use regex::Regex;

/// Rule execution mode
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleMode {
    /// CSS selector (default)
    Css,
    /// XPath query
    XPath,
    /// JSONPath query
    Json,
    /// JavaScript
    Js,
    /// Regular expression
    Regex,
}

/// A single parsed rule
#[derive(Debug, Clone, PartialEq)]
pub struct SourceRule {
    /// The rule string (after mode prefix removal)
    pub rule: String,
    /// Execution mode
    pub mode: RuleMode,
    /// Regex pattern for replacement
    pub replace_regex: String,
    /// Replacement string
    pub replacement: String,
    /// Replace only first match
    pub replace_first: bool,
    /// @put: variables to set
    pub put_map: Vec<(String, String)>,
}

impl Default for SourceRule {
    fn default() -> Self {
        Self {
            rule: String::new(),
            mode: RuleMode::Css,
            replace_regex: String::new(),
            replacement: String::new(),
            replace_first: false,
            put_map: Vec::new(),
        }
    }
}

/// Parser for book source rule strings
pub struct RuleParser {
    /// Regex for JS blocks: <js>...</js>
    js_block_re: Regex,
    /// Regex for inline JS: {{...}}
    #[allow(dead_code)]
    inline_js_re: Regex,
    /// Regex for @get: references
    #[allow(dead_code)]
    get_re: Regex,
}

impl RuleParser {
    pub fn new() -> Self {
        Self {
            js_block_re: Regex::new(r"(?i)<js>([\s\S]*?)</js>").unwrap(),
            inline_js_re: Regex::new(r"\{\{([\s\S]*?)\}\}").unwrap(),
            get_re: Regex::new(r"(?i)@get:\{([^}]+)\}").unwrap(),
        }
    }

    /// Parse a rule string into a list of SourceRules
    ///
    /// Rules can be chained with `##` separators for regex replacement:
    /// `rule##regex##replacement###` (### means replace first only)
    pub fn parse(&self, rule_str: &str) -> Vec<SourceRule> {
        if rule_str.is_empty() {
            return Vec::new();
        }

        // Check if the entire string is a JS block
        if let Some(caps) = self.js_block_re.captures(rule_str) {
            if caps.get(0).unwrap().as_str() == rule_str {
                return vec![SourceRule {
                    rule: caps[1].to_string(),
                    mode: RuleMode::Js,
                    ..Default::default()
                }];
            }
        }

        // Split by `&&` for chained rules
        let parts: Vec<&str> = rule_str.split("&&").collect();
        parts
            .into_iter()
            .map(|part| self.parse_single_rule(part.trim()))
            .collect()
    }

    fn parse_single_rule(&self, rule_str: &str) -> SourceRule {
        let mut rule = SourceRule::default();

        // Detect mode prefix
        let rest = if rule_str.starts_with("@XPath:") {
            rule.mode = RuleMode::XPath;
            &rule_str[7..]
        } else if rule_str.starts_with("@Json:") {
            rule.mode = RuleMode::Json;
            &rule_str[6..]
        } else if rule_str.starts_with("@CSS:") {
            rule.mode = RuleMode::Css;
            &rule_str[5..]
        } else if rule_str.starts_with("@@") {
            // @@ means explicit CSS mode
            rule.mode = RuleMode::Css;
            &rule_str[2..]
        } else if rule_str.starts_with("/") || rule_str.starts_with("//") {
            // XPath starts with /
            rule.mode = RuleMode::XPath;
            rule_str
        } else if rule_str.starts_with("$.") || rule_str.starts_with("$[") {
            // JSONPath starts with $.
            rule.mode = RuleMode::Json;
            rule_str
        } else if self.js_block_re.is_match(rule_str) {
            rule.mode = RuleMode::Js;
            rule_str
        } else {
            rule.mode = RuleMode::Css;
            rule_str
        };

        // Handle regex replacement: rule##regex##replacement###
        let parts: Vec<&str> = rest.split("##").collect();
        rule.rule = parts[0].to_string();

        if parts.len() > 1 {
            rule.replace_regex = parts[1].to_string();
        }
        if parts.len() > 2 {
            rule.replacement = parts[2].to_string();
        }
        if parts.len() > 3 {
            rule.replace_first = true;
        }

        // Handle inline JS and @get references in the rule
        rule.rule = self.process_js_in_rule(&rule.rule);

        rule
    }

    fn process_js_in_rule(&self, rule: &str) -> String {
        // For now, keep inline JS markers in the rule string
        // The actual evaluation will happen at execution time
        rule.to_string()
    }

    /// Check if a string is a JSONPath expression
    pub fn is_json_path(s: &str) -> bool {
        s.starts_with("$.") || s.starts_with("$[")
    }

    /// Check if a string is an XPath expression
    pub fn is_xpath(s: &str) -> bool {
        s.starts_with("/") || s.starts_with("@XPath:")
    }
}

impl Default for RuleParser {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_css_rule() {
        let parser = RuleParser::new();
        let rules = parser.parse("class.book-list@tag.a@text");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].mode, RuleMode::Css);
        assert_eq!(rules[0].rule, "class.book-list@tag.a@text");
    }

    #[test]
    fn test_parse_xpath_rule() {
        let parser = RuleParser::new();
        let rules = parser.parse("@XPath://div[@class='title']");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].mode, RuleMode::XPath);
        assert_eq!(rules[0].rule, "//div[@class='title']");
    }

    #[test]
    fn test_parse_json_rule() {
        let parser = RuleParser::new();
        let rules = parser.parse("$.books[0].title");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].mode, RuleMode::Json);
        assert_eq!(rules[0].rule, "$.books[0].title");
    }

    #[test]
    fn test_parse_js_block() {
        let parser = RuleParser::new();
        let rules = parser.parse("<js>result.replace(/\\s+/g, ' ')</js>");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].mode, RuleMode::Js);
        assert_eq!(rules[0].rule, "result.replace(/\\s+/g, ' ')");
    }

    #[test]
    fn test_parse_regex_replace() {
        let parser = RuleParser::new();
        let rules = parser.parse("class.content@text##\\s+##REPLACEMENT");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].mode, RuleMode::Css);
        assert_eq!(rules[0].rule, "class.content@text");
        assert_eq!(rules[0].replace_regex, "\\s+");
        assert_eq!(rules[0].replacement, "REPLACEMENT");
        assert!(!rules[0].replace_first);
    }

    #[test]
    fn test_parse_regex_replace_first() {
        let parser = RuleParser::new();
        let rules = parser.parse("class.title@text##第(.*?)章##$1###");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].replace_regex, "第(.*?)章");
        assert_eq!(rules[0].replacement, "$1");
        assert!(rules[0].replace_first);
    }

    #[test]
    fn test_parse_chained_rules() {
        let parser = RuleParser::new();
        let rules = parser.parse("class.list@tag.a&&class.info@tag.span@text");
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].rule, "class.list@tag.a");
        assert_eq!(rules[1].rule, "class.info@tag.span@text");
    }
}
