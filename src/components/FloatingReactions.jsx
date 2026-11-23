import React from 'react';

export default function FloatingReactions({ reactions = [], toast = null }) {
  return (
    <div className="jam-overlays-container" style={{ pointerEvents: 'none' }}>
      {/* Toast Notification */}
      {toast && (
        <div className="jam-activity-toast">
          <span>{toast}</span>
        </div>
      )}

      {/* Floating Reaction Emojis */}
      <div className="floating-reactions-wrapper">
        {reactions.map((r) => (
          <div
            key={r.id}
            className="floating-emoji"
            style={{
              left: `${r.x}%`,
              animationDuration: `${r.duration || 2.2}s`
            }}
          >
            <span className="emoji-char">{r.emoji}</span>
            {r.from && <span className="emoji-sender">{r.from}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
