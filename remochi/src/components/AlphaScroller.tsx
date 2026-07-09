import React from 'react';

const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface Props {
  onSelect: (letter: string) => void;
}

export default function AlphaScroller({ onSelect }: Props) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      position: 'fixed',
      right: 8,
      top: '50%',
      transform: 'translateY(-50%)',
      gap: 1,
      zIndex: 10,
    }}>
      {LETTERS.map((l) => (
        <button
          key={l}
          onClick={() => onSelect(l)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            padding: '1px 4px',
            color: 'var(--mochi-accent)',
            lineHeight: 1.2,
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
