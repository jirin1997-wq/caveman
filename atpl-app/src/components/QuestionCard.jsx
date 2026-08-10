export default function QuestionCard({ question, onAnswer, showResults, selectedAnswer }) {
  return (
    <div className="question-card">
      <h2>{question.question}</h2>

      <div className="options">
        {question.options.map((option, index) => (
          <button
            key={index}
            onClick={() => !showResults && onAnswer(index)}
            disabled={showResults}
            className={`option ${
              selectedAnswer === index
                ? index === question.correctAnswer
                  ? 'correct'
                  : 'incorrect'
                : showResults && index === question.correctAnswer
                  ? 'correct-unselected'
                  : ''
            }`}
          >
            <span className="option-letter">
              {String.fromCharCode(65 + index)})
            </span>
            <span className="option-text">{option}</span>
            {showResults && index === question.correctAnswer && (
              <span className="checkmark">✓</span>
            )}
            {showResults && selectedAnswer === index && index !== question.correctAnswer && (
              <span className="crossmark">✗</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
