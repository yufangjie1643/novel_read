import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Bookshelf from './pages/Bookshelf';
import Explore from './pages/Explore';
import Home from './pages/Home';
import BookDetail from './pages/BookDetail';
import Reader from './pages/Reader';
import DebugPage from './pages/DebugPage';
import RssPage from './pages/RssPage';
import ReplaceRules from './pages/ReplaceRules';
import Bookmarks from './pages/Bookmarks';
import ReadStats from './pages/ReadStats';
import Settings from './pages/Settings';
import BookSources from './pages/BookSources';
import ConfigMarket from './pages/ConfigMarket';

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Bookshelf />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/search" element={<Home />} />
          <Route path="/rss" element={<RssPage />} />
          <Route path="/debug" element={<DebugPage />} />
          <Route path="/replace-rules" element={<ReplaceRules />} />
          <Route path="/bookmarks" element={<Bookmarks />} />
          <Route path="/stats" element={<ReadStats />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/book-sources" element={<BookSources />} />
          <Route path="/config-market" element={<ConfigMarket />} />
          <Route path="/book/:bookUrl" element={<BookDetail />} />
          <Route path="/reader/:bookUrl/:chapterIndex" element={<Reader />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
