export default function TypingIndicator() {
  return (
    <div className="typing-indicator" aria-live="polite">
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-text">User is typing...</span>
    </div>
  );
}
