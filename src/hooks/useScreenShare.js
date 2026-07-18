import { useCallback, useRef, useState } from "react";

export function useScreenShare({ localStreamRef, localVideoRef, peerConnectionRef, socketRef, roomIdRef, setStatus }) {
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const screenStreamRef = useRef(null);
  const cameraVideoTrackRef = useRef(null);

  const emitScreenShareToggle = useCallback((event) => {
    const socket = socketRef.current;
    const roomId = roomIdRef.current;

    if (socket?.connected && roomId) {
      socket.emit(event, { roomId, active: event === "screen-share-start" });
    }
  }, [roomIdRef, socketRef]);

  const replaceVideoTrack = useCallback(async (track) => {
    const peerConnection = peerConnectionRef.current;

    if (!peerConnection) {
      return false;
    }

    const sender = peerConnection.getSenders().find((item) => item.track?.kind === "video");
    if (!sender) {
      return false;
    }

    await sender.replaceTrack(track);
    return true;
  }, [peerConnectionRef]);

  const stopScreenShare = useCallback(async ({ silent = false } = {}) => {
    const screenStream = screenStreamRef.current;
    const cameraTrack = cameraVideoTrackRef.current ?? localStreamRef.current?.getVideoTracks?.()[0] ?? null;

    if (!screenStream) {
      return;
    }

    screenStream.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;

    if (cameraTrack) {
      await replaceVideoTrack(cameraTrack);
    }

    const localStream = localStreamRef.current;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }

    setIsScreenSharing(false);

    if (!silent) {
      emitScreenShareToggle("screen-share-stop");
      setStatus?.("Screen sharing stopped.");
    }
  }, [emitScreenShareToggle, localStreamRef, localVideoRef, replaceVideoTrack, setStatus]);

  const shareScreen = useCallback(async () => {
    if (isScreenSharing) {
      await stopScreenShare();
      return;
    }

    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });

    const screenTrack = displayStream.getVideoTracks()[0];
    if (!screenTrack) {
      throw new Error("Screen sharing is not available.");
    }

    cameraVideoTrackRef.current = localStreamRef.current?.getVideoTracks?.()[0] ?? null;
    screenStreamRef.current = displayStream;

    await replaceVideoTrack(screenTrack);

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = displayStream;
    }

    setIsScreenSharing(true);
    emitScreenShareToggle("screen-share-start");
    setStatus?.("Screen sharing started.");

    screenTrack.onended = () => {
      void stopScreenShare();
    };
  }, [emitScreenShareToggle, isScreenSharing, localStreamRef, localVideoRef, replaceVideoTrack, setStatus, stopScreenShare]);

  return {
    isScreenSharing,
    shareScreen,
    stopScreenShare,
  };
}
