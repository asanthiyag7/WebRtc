import FileMessage from "./FileMessage.jsx";
import { formatTimeLabel } from "../hooks/useChat.js";

export default function MessageBubble({ message }) {
  const isOwn = !!message.outgoing;

  return (
    <article className={`message-bubble ${isOwn ? "message-own" : "message-peer"}`}>
      <div className="message-bubble-meta">
        <span className="message-sender">{message.senderName}</span>
        <time className="message-time" dateTime={message.time}>
          {formatTimeLabel(message.time)}
        </time>
      </div>

      {message.type === "file" ? (
        <FileMessage message={message} />
      ) : (
        <p className="message-text">{message.text}</p>
      )}
    </article>
  );
}
