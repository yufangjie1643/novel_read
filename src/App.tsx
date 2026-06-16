import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Bookshelf from './pages/Bookshelf';
import Explore from './pages/Explore';
import ExploreShow from './pages/ExploreShow';
import Home from './pages/Home';
import BookDetail from './pages/BookDetail';
import Reader from './pages/Reader';
import ChapterCatalog from './pages/ChapterCatalog';
import DebugPage from './pages/DebugPage';
import RssPage from './pages/RssPage';
import ReplaceRules from './pages/ReplaceRules';
import Bookmarks from './pages/Bookmarks';
import ReadStats from './pages/ReadStats';
import Settings from './pages/Settings';
import BookSources from './pages/BookSources';
import ConfigMarket from './pages/ConfigMarket';
import TxtTocRules from './pages/TxtTocRules';
import DictRules from './pages/DictRules';
import FileManager from './pages/FileManager';
import About from './pages/About';
import Sources from './pages/Sources';
import SourceEdit from './pages/SourceEdit';
import SourceImport from './pages/SourceImport';

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Bookshelf />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/explore-show" element={<ExploreShow />} />
          <Route path="/search" element={<Home />} />
          <Route path="/rss" element={<RssPage />} />
          <Route path="/debug" element={<DebugPage />} />
          <Route path="/replace-rules" element={<ReplaceRules />} />
          <Route path="/bookmarks" element={<Bookmarks />} />
          <Route path="/stats" element={<ReadStats />} />
          <Route path="/settings/*" element={<Settings />} />
          <Route path="/book-sources" element={<BookSources />} />
          <Route path="/sources" element={<Sources />} />
          <Route path="/sources/import" element={<SourceImport />} />
          <Route path="/sources/:sourceUrl" element={<SourceEdit />} />
          <Route path="/config-market" element={<ConfigMarket />} />
          <Route path="/txt-toc-rules" element={<TxtTocRules />} />
          <Route path="/dict-rules" element={<DictRules />} />
          <Route path="/file-manager" element={<FileManager />} />
          <Route path="/about" element={<About />} />
          <Route path="/book/:bookUrl" element={<BookDetail />} />
          <Route path="/reader/:bookUrl/:chapterIndex" element={<Reader />} />
          <Route path="/reader/:bookUrl/:chapterIndex/catalog" element={<ChapterCatalog />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
