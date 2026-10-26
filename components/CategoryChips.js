"use client";
export default function CategoryChips({ categories, value, onChange }) {
  return <div className="category-chips" aria-label="category">
    {categories.filter(c => !c.archived || c.id === value).map(c => <button type="button" key={c.id}
      aria-pressed={value === c.id} onClick={() => onChange(value === c.id ? null : c.id)}>{c.name}</button>)}
  </div>;
}
