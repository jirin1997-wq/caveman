import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import SearchPage from './pages/SearchPage';
import DetailPage from './pages/DetailPage';
import './index.css';

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">🏠</span>
              <span className="text-lg font-bold tracking-tight text-slate-900">Reality Scout</span>
            </Link>
            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-xs font-semibold">
              beta
            </span>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/listing/:id" element={<DetailPage />} />
        </Routes>
      </div>
    </Router>
  );
}
