import { useRef } from "react";
import MessageBubble from "./MessageBubble.jsx";
import TypingIndicator from "./TypingIndicator.jsx";

const ACCEPTED_FILE_TYPES = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.zip,.txt";

export default function ChatBox({
  messages,
  draft,
  onDraftChange,
  onSendMessage,
  onAttachFile,
  onEmojiClick,
  peerTyping,
  unreadCount,
  messagesEndRef,
  onFocus,
  onBlur,
  peerName = "Peer",
}) {
  const fileInputRef = useRef(null);

  const handleAttachmentClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (file) {
      onAttachFile?.(file);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSendMessage?.();
    }
  };

  return (
    <section className="chat-box">
      <header className="chat-header">
        <div>
          <p className="eyebrow small">Chat</p>
          <h2>Room messages</h2>
        </div>
        <div className="chat-header-meta">
          {unreadCount > 0 ? <span className="unread-badge">{unreadCount}</span> : null}
          <span className="chat-peer-label">{peerName}</span>
        </div>
      </header>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>No messages yet.</p>
            <span>Send a note, a file, or a quick reaction to get started.</span>
          </div>
        ) : null}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {peerTyping ? <TypingIndicator /> : null}
        <div ref={messagesEndRef} />
      </div>

      <footer className="chat-footer">
        <button type="button" className="chat-icon-button" onClick={onEmojiClick} title="Emoji placeholder">
          ☺
        </button>
        <button type="button" className="chat-icon-button" onClick={handleAttachmentClick} title="Attach file">
          📎
        </button>
        <input
          ref={fileInputRef}
          className="chat-file-input"
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          onChange={handleFileChange}
        />
        <textarea
          className="chat-input"
          rows={1}
          value={draft}
          placeholder="Write a message..."
          onChange={(event) => onDraftChange?.(event.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
        />
        <button type="button" className="chat-send" onClick={onSendMessage} disabled={!draft.trim()}>
          Send
        </button>
      </footer>
    </section>
  );
}
