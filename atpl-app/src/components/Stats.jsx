export default function Stats({ stats }) {
  return (
    <div className="stats">
      <div className="stat-item">
        <span className="stat-label">Správně:</span>
        <span className="stat-value">{stats.correct}/{stats.total}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Úspěšnost:</span>
        <span className="stat-value">{stats.percentage}%</span>
      </div>
    </div>
  );
}
