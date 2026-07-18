import { useCallback, useEffect, useRef, useState } from "react";

function createMessageId(prefix = "msg") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatTimeLabel(value) {
  const date = value instanceof Date ? value : new Date(value);

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  const precision = index === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[index]}`;
}

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [peerTyping, setPeerTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef(null);
  const peerTypingTimerRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (peerTypingTimerRef.current) {
        window.clearTimeout(peerTypingTimerRef.current);
      }
    };
  }, []);

  const appendMessage = useCallback((message, { incoming = false } = {}) => {
    const nextMessage = {
      id: message.id ?? createMessageId(message.type ?? "message"),
      type: message.type ?? "text",
      senderName: message.senderName ?? (incoming ? "Peer" : "You"),
      text: message.text ?? "",
      outgoing: message.outgoing ?? !incoming,
      time: message.time ?? new Date().toISOString(),
      status: message.status ?? "sent",
      ...message,
    };

    setMessages((current) => [...current, nextMessage]);

    if (incoming) {
      setUnreadCount((count) => count + 1);
    }

    return nextMessage;
  }, []);

  const updateMessage = useCallback((messageId, patch) => {
    setMessages((current) => current.map((message) => (message.id === messageId ? { ...message, ...patch } : message)));
  }, []);

  const removeMessage = useCallback((messageId) => {
    setMessages((current) => current.filter((message) => message.id !== messageId));
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setPeerTyping(false);
    setUnreadCount(0);
  }, []);

  const markChatRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const setPeerTypingIndicator = useCallback((value) => {
    if (peerTypingTimerRef.current) {
      window.clearTimeout(peerTypingTimerRef.current);
      peerTypingTimerRef.current = null;
    }

    if (!value) {
      setPeerTyping(false);
      return;
    }

    setPeerTyping(true);
    peerTypingTimerRef.current = window.setTimeout(() => {
      setPeerTyping(false);
      peerTypingTimerRef.current = null;
    }, 2000);
  }, []);

  return {
    messages,
    appendMessage,
    updateMessage,
    removeMessage,
    clearChat,
    peerTyping,
    setPeerTypingIndicator,
    unreadCount,
    markChatRead,
    messagesEndRef,
  };
}
