import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import SearchPage from './pages/SearchPage';
import DetailPage from './pages/DetailPage';
import './index.css';

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <h1 className="text-2xl font-bold text-blue-600">🏠 Reality Scout</h1>
            <p className="text-gray-600 text-sm">Find Czech properties. Track prices.</p>
          </div>
        </nav>

        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/listing/:id" element={<DetailPage />} />
        </Routes>
      </div>
    </Router>
  );
}
