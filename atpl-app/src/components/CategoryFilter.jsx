export default function CategoryFilter({ categories, selected, onSelect }) {
  return (
    <div className="category-filter">
      <h3>Kategorie</h3>
      <button
        className={`category-btn ${selected === 'all' ? 'active' : ''}`}
        onClick={() => onSelect('all')}
      >
        Všechny
      </button>
      {categories.map(category => (
        <button
          key={category}
          className={`category-btn ${selected === category ? 'active' : ''}`}
          onClick={() => onSelect(category)}
        >
          {category}
        </button>
      ))}
    </div>
  );
}
