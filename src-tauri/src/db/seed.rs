//! First-run defaults: write the bundled `RuleSub` and `RssSource` rows
//! when their tables are empty. Safe to call on every startup; no-ops
//! once data is present.

use rusqlite::Connection;

use super::dao::{RssSourceDao, RuleSubDao};
use super::models::{RssSource, RuleSub};

pub fn seed_defaults(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    seed_rule_subs(conn)?;
    seed_rss_sources(conn)?;
    Ok(())
}

fn seed_rule_subs(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let dao = RuleSubDao::new(conn);
    let subs = dao.get_all().unwrap_or_default();
    if !subs.is_empty() {
        return Ok(());
    }
    let defaults = [
        RuleSub {
            id: None,
            name: Some("喵公子书源".to_string()),
            url: Some("http://yuedu.miaogongzi.net/shuyuan".to_string()),
            sub_type: 0,
            custom_order: 0,
            enabled: true,
            auto_update: true,
            last_update_time: 0,
        },
        RuleSub {
            id: None,
            name: Some("Nya源·合集".to_string()),
            url: Some(
                "https://shuyuan.nyasama.cc/cdn/5f626361539d546e6fa3a02b24598284.json"
                    .to_string(),
            ),
            sub_type: 0,
            custom_order: 1,
            enabled: true,
            auto_update: true,
            last_update_time: 0,
        },
    ];
    for sub in &defaults {
        let _ = dao.insert(sub);
    }
    Ok(())
}

fn seed_rss_sources(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let dao = RssSourceDao::new(conn);
    let sources = dao.get_all().unwrap_or_default();
    if !sources.is_empty() {
        return Ok(());
    }
    let defaults = [
        RssSource {
            source_url: "https://www.yuque.com/legado".to_string(),
            source_name: "使用说明".to_string(),
            source_group: Some("legado".to_string()),
            source_icon: Some(
                "https://cdn.jsdelivr.net/gh/gedoor/legado@master/app/src/main/res/mipmap-hdpi/ic_launcher.png"
                    .to_string(),
            ),
            enabled: true,
            variable: None,
            custom_order: 2,
            last_update_time: 0,
            login_url: None,
            login_ui: None,
            header: None,
            sort_url: None,
            rule_articles: None,
            rule_next_page: None,
            rule_title: None,
            rule_pub_date: None,
            rule_description: None,
            rule_image: None,
            rule_link: None,
            rule_content: None,
            single_url: false,
        },
        RssSource {
            source_url: "snssdk1128://user/profile/562564899806367".to_string(),
            source_name: "小说拾遗".to_string(),
            source_group: Some("legado".to_string()),
            source_icon: Some(
                "http://mmbiz.qpic.cn/mmbiz_png/MSvbRVunjxNFqy9DVEIF9s7EJRSozqWibESyVRvqn7RhJpKHfkq8HuwloAvMFMHrLGIvXNTT5ibqeqAcPDg0icibicA/0?wx_fmt=png"
                    .to_string(),
            ),
            enabled: true,
            variable: None,
            custom_order: 3,
            last_update_time: 0,
            login_url: None,
            login_ui: None,
            header: None,
            sort_url: None,
            rule_articles: None,
            rule_next_page: None,
            rule_title: None,
            rule_pub_date: None,
            rule_description: None,
            rule_image: None,
            rule_link: None,
            rule_content: None,
            single_url: false,
        },
        RssSource {
            source_url: "https://pan.miaogongzi.net".to_string(),
            source_name: "Meow云".to_string(),
            source_group: Some("legado".to_string()),
            source_icon: Some(
                "https://cdn.jsdelivr.net/gh/mgz0227/meowcloud/icon.png".to_string(),
            ),
            enabled: true,
            variable: None,
            custom_order: 4,
            last_update_time: 0,
            login_url: None,
            login_ui: None,
            header: None,
            sort_url: None,
            rule_articles: None,
            rule_next_page: None,
            rule_title: None,
            rule_pub_date: None,
            rule_description: None,
            rule_image: None,
            rule_link: None,
            rule_content: None,
            single_url: false,
        },
        RssSource {
            source_url: "https://www.lanzoux.com/b0bw8jwoh".to_string(),
            source_name: "烏雲净化".to_string(),
            source_group: Some("legado".to_string()),
            source_icon: Some(
                "https://cdn.jsdelivr.net/gh/gedoor/legado@master/app/src/main/res/mipmap-hdpi/ic_launcher.png"
                    .to_string(),
            ),
            enabled: true,
            variable: None,
            custom_order: 5,
            last_update_time: 0,
            login_url: None,
            login_ui: None,
            header: None,
            sort_url: None,
            rule_articles: None,
            rule_next_page: None,
            rule_title: None,
            rule_pub_date: None,
            rule_description: None,
            rule_image: None,
            rule_link: None,
            rule_content: None,
            single_url: false,
        },
        RssSource {
            source_url: "https://yuedu.miaogongzi.net/gx.html".to_string(),
            source_name: "喵公子更新".to_string(),
            source_group: Some("书源".to_string()),
            source_icon: None,
            enabled: true,
            variable: None,
            custom_order: 6,
            last_update_time: 0,
            login_url: None,
            login_ui: None,
            header: None,
            sort_url: None,
            rule_articles: None,
            rule_next_page: None,
            rule_title: None,
            rule_pub_date: None,
            rule_description: None,
            rule_image: None,
            rule_link: None,
            rule_content: None,
            single_url: true,
        },
    ];
    for source in &defaults {
        let _ = dao.insert(source);
    }
    Ok(())
}
