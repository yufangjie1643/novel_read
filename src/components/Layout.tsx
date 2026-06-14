import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUiMode } from '../uiMode';

const navPaths = [
  '/',
  '/explore',
  '/search',
  '/book-sources',
  '/config-market',
  '/rss',
  '/replace-rules',
  '/bookmarks',
  '/stats',
  '/settings',
] as const;

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { isMobileUi } = useUiMode();
  const isReader = location.pathname.startsWith('/reader/');
  const isWidePage = location.pathname.startsWith('/config-market');

  const navLabels: Record<string, string> = {
    '/': t('layout.bookshelf'),
    '/explore': t('layout.explore'),
    '/search': t('layout.searchPage'),
    '/book-sources': t('layout.bookSources'),
    '/config-market': t('layout.configMarket'),
    '/rss': t('layout.rss'),
    '/replace-rules': t('layout.replaceRules'),
    '/bookmarks': t('layout.bookmarks'),
    '/stats': t('layout.stats'),
    '/settings': t('layout.settings'),
  };

  const mobileTabs = [
    {
      path: '/',
      label: t('layout.bookshelf'),
      lineIcon: '/mobile-media/home_line.svg',
      fillIcon: '/mobile-media/home_fill.svg',
      activePaths: ['/'],
    },
    {
      path: '/explore',
      label: t('layout.explore'),
      lineIcon: '/mobile-media/find_line.svg',
      fillIcon: '/mobile-media/find_fill.svg',
      activePaths: ['/explore', '/search'],
    },
    {
      path: '/rss',
      label: t('layout.subscription', { defaultValue: '订阅' }),
      lineIcon: '/mobile-media/sub_line.svg',
      fillIcon: '/mobile-media/sub_fill.svg',
      activePaths: ['/rss'],
    },
    {
      path: '/settings',
      label: t('layout.mine', { defaultValue: '我的' }),
      lineIcon: '/mobile-media/mine_line.svg',
      fillIcon: '/mobile-media/mine_fill.svg',
      activePaths: [
        '/settings',
        '/book-sources',
        '/config-market',
        '/replace-rules',
        '/bookmarks',
        '/stats',
        '/debug',
      ],
    },
  ] as const;

  function toggleLang() {
    const next = i18n.language.startsWith('zh') ? 'en' : 'zh';
    i18n.changeLanguage(next);
  }

  function isActivePath(path: (typeof navPaths)[number]) {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  }

  const appShellStyle: React.CSSProperties = {
    fontFamily: isMobileUi
      ? "'Microsoft YaHei', 'PingFang SC', 'Segoe UI', sans-serif"
      : "'Inter', system-ui, -apple-system, sans-serif",
    background: isMobileUi ? '#f8faf7' : '#f5f7fa',
    minHeight: '100vh',
    overflowX: 'hidden',
  };

  if (isMobileUi) {
    const mobileMainPadding = isReader
      ? '0'
      : 'calc(24px + var(--legado-safe-top)) calc(20px + var(--legado-safe-right)) calc(104px + var(--legado-safe-bottom)) calc(20px + var(--legado-safe-left))';

    return (
      <div className="android-app-shell" style={appShellStyle}>
        <main
          className="android-main"
          style={{
            padding: mobileMainPadding,
            maxWidth: '100%',
            margin: '0 auto',
          }}
        >
          {children}
        </main>
        {!isReader && (
          <nav className="android-bottom-tabs" aria-label={t('layout.title')}>
            {mobileTabs.map((tab) => {
              const active = tab.activePaths.some((path) =>
                path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
              );
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  className={active ? 'active' : undefined}
                  aria-current={active ? 'page' : undefined}
                >
                  <img src={active ? tab.fillIcon : tab.lineIcon} alt="" />
                  <span>{tab.label}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    );
  }

  return (
    <div style={appShellStyle}>
      {!isReader && (
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 24px',
            borderBottom: '1px solid #e8e8f0',
            background: '#fff',
            position: 'sticky',
            top: 0,
            zIndex: 100,
            boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 20,
              marginRight: 24,
              color: '#1976d2',
              letterSpacing: 0,
            }}
          >
            {t('layout.title')}
          </div>
          {navPaths.map((path) => {
            const active = isActivePath(path);
            return (
              <Link
                key={path}
                to={path}
                style={{
                  textDecoration: 'none',
                  color: active ? '#1976d2' : '#555',
                  fontWeight: active ? 600 : 500,
                  padding: '6px 14px',
                  borderRadius: 8,
                  background: active ? '#eef4fd' : 'transparent',
                  fontSize: 14,
                  transition: 'all 0.2s',
                }}
              >
                {navLabels[path]}
              </Link>
            );
          })}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#888' }}>{t('layout.language')}</span>
            <button
              onClick={toggleLang}
              style={{
                padding: '4px 12px',
                fontSize: 13,
                border: '1px solid #ddd',
                borderRadius: 6,
                background: '#fff',
                cursor: 'pointer',
                fontWeight: 500,
                color: '#555',
              }}
            >
              {i18n.language.startsWith('zh') ? t('layout.langEn') : t('layout.langZh')}
            </button>
          </div>
        </nav>
      )}
      <main
        style={{
          padding: isReader ? 0 : '24px 20px 60px',
          maxWidth: isReader ? 'none' : isWidePage ? 1320 : 960,
          margin: '0 auto',
        }}
      >
        {children}
      </main>
    </div>
  );
}
