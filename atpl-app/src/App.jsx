import { useState, useMemo } from 'react';
import questionsData from './data/questions.json';
import QuestionCard from './components/QuestionCard';
import Stats from './components/Stats';
import CategoryFilter from './components/CategoryFilter';
import './App.css';

export default function App() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answered, setAnswered] = useState({});
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showResults, setShowResults] = useState(false);

  const filteredQuestions = useMemo(() => {
    if (selectedCategory === 'all') {
      return questionsData.questions;
    }
    return questionsData.questions.filter(q => q.category === selectedCategory);
  }, [selectedCategory]);

  const currentQuestion = filteredQuestions[currentIndex] || null;
  const allCategories = [...new Set(questionsData.questions.map(q => q.category))];

  const stats = {
    correct: Object.values(answered).filter(a => a.isCorrect).length,
    total: Object.keys(answered).length,
    percentage: Object.keys(answered).length > 0
      ? Math.round((Object.values(answered).filter(a => a.isCorrect).length / Object.keys(answered).length) * 100)
      : 0
  };

  const handleAnswer = (selectedIndex) => {
    const isCorrect = selectedIndex === currentQuestion.correctAnswer;
    setAnswered({
      ...answered,
      [currentQuestion.id]: {
        selectedIndex,
        isCorrect,
        question: currentQuestion
      }
    });
    setShowResults(true);
  };

  const handleNext = () => {
    if (currentIndex < filteredQuestions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setShowResults(false);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setShowResults(false);
    }
  };

  const handleReset = () => {
    setCurrentIndex(0);
    setAnswered({});
    setShowResults(false);
  };

  const handleCategoryChange = (category) => {
    setSelectedCategory(category);
    setCurrentIndex(0);
    setShowResults(false);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>✈️ ATPL Question Study App</h1>
        <Stats stats={stats} />
      </header>

      <main className="main">
        <aside className="sidebar">
          <CategoryFilter
            categories={allCategories}
            selected={selectedCategory}
            onSelect={handleCategoryChange}
          />
        </aside>

        <div className="content">
          {currentQuestion ? (
            <>
              <div className="question-info">
                <span className="question-number">
                  {currentIndex + 1} / {filteredQuestions.length}
                </span>
                <span className="category-badge">{currentQuestion.category}</span>
                <span className={`difficulty ${currentQuestion.difficulty}`}>
                  {currentQuestion.difficulty.toUpperCase()}
                </span>
              </div>

              <QuestionCard
                question={currentQuestion}
                onAnswer={handleAnswer}
                showResults={showResults}
                selectedAnswer={answered[currentQuestion.id]?.selectedIndex}
              />

              {showResults && (
                <div className="explanation">
                  <h4>Vysvětlení:</h4>
                  <p>{currentQuestion.explanation}</p>
                </div>
              )}

              <div className="navigation">
                <button
                  onClick={handlePrev}
                  disabled={currentIndex === 0}
                  className="btn btn-secondary"
                >
                  ← Předchozí
                </button>
                <button
                  onClick={handleNext}
                  disabled={currentIndex === filteredQuestions.length - 1 || !showResults}
                  className="btn btn-primary"
                >
                  Další →
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p>Žádné otázky v této kategorii.</p>
            </div>
          )}

          {Object.keys(answered).length > 0 && (
            <button onClick={handleReset} className="btn btn-danger">
              🔄 Začít znovu
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
