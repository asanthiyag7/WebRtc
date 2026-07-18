import { useCallback, useEffect, useState } from "react";

export function useMediaControls({ localStreamRef, socketRef, roomIdRef, setStatus }) {
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  const syncMediaState = useCallback(() => {
    const stream = localStreamRef.current;
    const audioTrack = stream?.getAudioTracks?.()[0] ?? null;
    const videoTrack = stream?.getVideoTracks?.()[0] ?? null;

    setIsMuted(audioTrack ? !audioTrack.enabled : false);
    setIsCameraOff(videoTrack ? !videoTrack.enabled : false);
  }, [localStreamRef]);

  const emitMediaToggle = useCallback((event, enabled) => {
    const socket = socketRef.current;
    const roomId = roomIdRef.current;

    if (socket?.connected && roomId) {
      socket.emit(event, { roomId, enabled });
    }
  }, [roomIdRef, socketRef]);

  const toggleMute = useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks?.()[0] ?? null;

    if (!audioTrack) {
      return false;
    }

    audioTrack.enabled = !audioTrack.enabled;
    setIsMuted(!audioTrack.enabled);
    emitMediaToggle("audio-toggle", audioTrack.enabled);
    setStatus?.(audioTrack.enabled ? "Microphone unmuted." : "Microphone muted.");
    return true;
  }, [emitMediaToggle, localStreamRef, setStatus]);

  const toggleCamera = useCallback(() => {
    const videoTrack = localStreamRef.current?.getVideoTracks?.()[0] ?? null;

    if (!videoTrack) {
      return false;
    }

    videoTrack.enabled = !videoTrack.enabled;
    setIsCameraOff(!videoTrack.enabled);
    emitMediaToggle("video-toggle", videoTrack.enabled);
    setStatus?.(videoTrack.enabled ? "Camera turned on." : "Camera turned off.");
    return true;
  }, [emitMediaToggle, localStreamRef, setStatus]);

  useEffect(() => {
    syncMediaState();
  }, [syncMediaState]);

  return {
    isMuted,
    isCameraOff,
    syncMediaState,
    toggleMute,
    toggleCamera,
  };
}
