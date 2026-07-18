import { useCallback, useEffect, useRef, useState } from "react";

export function useTyping() {
  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef(null);

  const stopTyping = useCallback((onStopTyping) => {
    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    if (isTyping) {
      onStopTyping?.();
      setIsTyping(false);
    }
  }, [isTyping]);

  const startTyping = useCallback((onTyping, onStopTyping) => {
    if (!isTyping) {
      onTyping?.();
      setIsTyping(true);
    }

    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
    }

    typingTimerRef.current = window.setTimeout(() => {
      onStopTyping?.();
      setIsTyping(false);
      typingTimerRef.current = null;
    }, 2000);
  }, [isTyping]);

  const handleInputChange = useCallback((value, onTyping, onStopTyping) => {
    if (value.trim()) {
      startTyping(onTyping, onStopTyping);
      return;
    }

    stopTyping(onStopTyping);
  }, [startTyping, stopTyping]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        window.clearTimeout(typingTimerRef.current);
      }
    };
  }, []);

  return {
    isTyping,
    startTyping,
    stopTyping,
    handleInputChange,
  };
}
