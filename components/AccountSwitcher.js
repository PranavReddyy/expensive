"use client";

export default function AccountSwitcher({ profiles, activeId, onChange }) {
  if (!profiles.length) return null;
  return (
    <div aria-label="Accounts" style={{ display: 'flex', gap: 6, overflowX:'auto', marginBottom: 16 }}>
      {profiles.map(profile => (
        <button type="button" key={profile.id} aria-pressed={profile.id === activeId}
          onClick={() => onChange(profile.id)}
          style={{ flexShrink:0, whiteSpace:'nowrap', fontSize: 11, padding: '5px 12px', border: '1px solid',
            borderColor: profile.id === activeId ? 'var(--text)' : 'var(--border-light)',
            color: profile.id === activeId ? 'var(--text)' : 'var(--muted)',
            background: profile.id === activeId ? 'var(--subtle)' : 'transparent',
            fontWeight: profile.id === activeId ? 600 : 400, cursor: 'pointer' }}>
          {profile.name}
        </button>
      ))}
    </div>
  );
}
