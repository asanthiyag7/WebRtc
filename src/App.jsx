import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import logoImage from "./assets/LOGO.png";
import "./App.css";

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const socketUrl =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : window.location.origin;

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Something went wrong.";
}

function normalizeRoomCode(code) {
  return code.trim().toUpperCase();
}

function getSocketStatusMeta(state) {
  if (state === "connected") {
    return { label: "Online", tone: "connected" };
  }

  return { label: "Offline", tone: "disconnected" };
}

function getPeerStatusMeta(state) {
  if (state === "connected") {
    return { label: "Connected", tone: "connected" };
  }

  if (state === "connecting") {
    return { label: "Connecting", tone: "waiting" };
  }

  if (state === "failed" || state === "disconnected") {
    return { label: "Disconnected", tone: "disconnected" };
  }

  if (state === "waiting" || state === "idle") {
    return { label: "Waiting", tone: "waiting" };
  }

  return { label: state, tone: "waiting" };
}

function createFallbackStream() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;

  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#07111d";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#57d6ff";
    context.font = "bold 42px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText("Virtual camera fallback", canvas.width / 2, canvas.height / 2 - 10);
    context.fillStyle = "#ecf4ff";
    context.font = "24px Arial, sans-serif";
    context.fillText("No physical camera or microphone detected", canvas.width / 2, canvas.height / 2 + 36);
  }

  return canvas.captureStream(15);
}

function App() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(new MediaStream());
  const roomIdRef = useRef("");
  const roomCodeRef = useRef("");
  const roomStateRef = useRef("idle");
  const isHostRef = useRef(false);
  const callStartedRef = useRef(false);
  const isMakingOfferRef = useRef(false);
  const pendingIceCandidatesRef = useRef([]);

  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [status, setStatus] = useState("Connect to Socket.IO to start.");
  const [socketState, setSocketState] = useState("disconnected");
  const [connectionState, setConnectionState] = useState("idle");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [roomState, setRoomState] = useState("idle");
  const [cameraPermission, setCameraPermission] = useState("idle");
  const [microphonePermission, setMicrophonePermission] = useState("idle");
  const [endedRoomCode, setEndedRoomCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    roomCodeRef.current = roomCode;
    roomIdRef.current = roomCode;
  }, [roomCode]);

  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const stopLocalStream = useCallback(() => {
    const stream = localStreamRef.current;

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    setLocalStream(null);
    setCameraPermission("idle");
    setMicrophonePermission("idle");

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }, []);

  const resetRemoteStream = useCallback(() => {
    remoteStreamRef.current = new MediaStream();
    setRemoteStream(null);

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }, []);

  const closePeerConnection = useCallback(() => {
    const pc = peerConnectionRef.current;

    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onsignalingstatechange = null;
      pc.close();
      peerConnectionRef.current = null;
    }

    isMakingOfferRef.current = false;
    pendingIceCandidatesRef.current = [];
  }, []);

  const clearSession = useCallback(
    (nextStatus = "Connect to Socket.IO to start.") => {
      callStartedRef.current = false;
      setRoomCode("");
      setJoinCode("");
      setIsHost(false);
      setRoomState("idle");
      setConnectionState("idle");
      setEndedRoomCode("");
      roomIdRef.current = "";
      setStatus(nextStatus);
      closePeerConnection();
      resetRemoteStream();
      stopLocalStream();
    },
    [closePeerConnection, resetRemoteStream, stopLocalStream],
  );

  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
      setCameraPermission("granted");
      setMicrophonePermission("granted");
      return localStreamRef.current;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraPermission("granted");
      setMicrophonePermission("granted");
      setStatus("Camera and microphone are ready.");
      return stream;
    } catch (err) {
      if (err?.name === "NotAllowedError") {
        setCameraPermission("denied");
        setMicrophonePermission("denied");
        throw err;
      }

      const fallbackStream = createFallbackStream();
      localStreamRef.current = fallbackStream;
      setLocalStream(fallbackStream);
      setCameraPermission("granted");
      setMicrophonePermission("denied");
      setStatus("Using virtual fallback camera stream.");
      return fallbackStream;
    }
  }, []);

  const requestCameraPermission = useCallback(async () => {
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((track) => track.stop());
      setCameraPermission("granted");
      setStatus("Camera permission granted.");
    } catch (err) {
      setCameraPermission("denied");
      setError(formatError(err));
      setStatus("Camera permission denied.");
    }
  }, []);

  const requestMicrophonePermission = useCallback(async () => {
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophonePermission("granted");
      setStatus("Microphone permission granted.");
    } catch (err) {
      setMicrophonePermission("denied");
      setError(formatError(err));
      setStatus("Microphone permission denied.");
    }
  }, []);

  const drainPendingIceCandidates = useCallback(async (pc) => {
    const queuedCandidates = pendingIceCandidatesRef.current;
    pendingIceCandidatesRef.current = [];

    for (const candidate of queuedCandidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.error("Failed to add queued ICE candidate", err);
      }
    }
  }, []);

  const createPeerConnection = useCallback((stream) => {
    const existingPc = peerConnectionRef.current;
    if (existingPc && existingPc.signalingState !== "closed") {
      const senderTrackIds = new Set(
        existingPc.getSenders().map((sender) => sender.track?.id).filter(Boolean),
      );

      stream.getTracks().forEach((track) => {
        if (!senderTrackIds.has(track.id)) {
          existingPc.addTrack(track, stream);
        }
      });

      return existingPc;
    }

    const pc = new RTCPeerConnection(rtcConfig);

    const resolveState = () => {
      if (
        pc.connectionState === "connected" ||
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        return "connected";
      }

      if (pc.connectionState === "connecting" || pc.iceConnectionState === "checking") {
        return "connecting";
      }

      if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
        return "failed";
      }

      if (pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected") {
        return "disconnected";
      }

      return roomIdRef.current ? "waiting" : "idle";
    };

    const syncPeerState = () => {
      const nextState = resolveState();
      setConnectionState(nextState);

      if (nextState === "connected") {
        setStatus("Peer connected.");
      } else if (nextState === "connecting") {
        setStatus("Peer is connecting...");
      } else if (nextState === "failed") {
        setStatus("Connection failed. Try leaving the room and creating a new one.");
      } else if (nextState === "disconnected") {
        setStatus("The peer disconnected. Waiting for someone else to join.");
      }
    };

    pc.ontrack = (event) => {
      const [incomingStream] = event.streams;
      const remoteStreamInstance = remoteStreamRef.current;
      const tracks = incomingStream?.getTracks?.() ?? [event.track].filter(Boolean);

      tracks.forEach((track) => {
        const alreadyAdded = remoteStreamInstance
          .getTracks()
          .some((existingTrack) => existingTrack.id === track.id);

        if (!alreadyAdded) {
          remoteStreamInstance.addTrack(track);
        }
      });

      const nextRemoteStream = new MediaStream(remoteStreamInstance.getTracks());
      remoteStreamRef.current = nextRemoteStream;
      setRemoteStream(nextRemoteStream);

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = nextRemoteStream;
        void remoteVideoRef.current.play().catch(() => {});
      }
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      if (socketRef.current?.connected && roomIdRef.current) {
        socketRef.current.emit("webrtc-ice-candidate", {
          roomId: roomIdRef.current,
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = syncPeerState;
    pc.oniceconnectionstatechange = syncPeerState;
    pc.onsignalingstatechange = () => {
      console.log("signalingState", pc.signalingState);
    };

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    peerConnectionRef.current = pc;
    return pc;
  }, []);

  const handleOffer = useCallback(
    async (offer) => {
      if (!offer) {
        return;
      }

      const stream = await ensureLocalStream();
      const pc = createPeerConnection(stream);

      await pc.setRemoteDescription(offer);
      await drainPendingIceCandidates(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current?.emit("webrtc-answer", {
        roomId: roomIdRef.current,
        answer: pc.localDescription,
      });

      callStartedRef.current = true;
      setStatus("Answer sent. Exchanging ICE candidates...");
    },
    [createPeerConnection, drainPendingIceCandidates, ensureLocalStream],
  );

  const handleAnswer = useCallback(
    async (answer) => {
      if (!answer) {
        return;
      }

      const stream = await ensureLocalStream();
      const pc = createPeerConnection(stream);

      await pc.setRemoteDescription(answer);
      await drainPendingIceCandidates(pc);
      callStartedRef.current = true;
      setStatus("Answer received. Exchanging ICE candidates...");
    },
    [createPeerConnection, drainPendingIceCandidates, ensureLocalStream],
  );

  const handleIceCandidate = useCallback(async (candidate) => {
    if (!candidate) {
      return;
    }

    const pc = peerConnectionRef.current;

    if (!pc || !pc.remoteDescription) {
      pendingIceCandidatesRef.current.push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.error("Failed to add ICE candidate", err);
    }
  }, []);

  const startOffer = useCallback(async () => {
    if (callStartedRef.current || isMakingOfferRef.current) {
      return;
    }

    try {
      isMakingOfferRef.current = true;
      setError("");

      const socket = socketRef.current;
      if (!socket?.connected) {
        throw new Error("Socket.IO is not connected yet.");
      }

      if (!roomIdRef.current) {
        throw new Error("Create or join a room first.");
      }

      const stream = await ensureLocalStream();
      const pc = createPeerConnection(stream);

      if (pc.signalingState !== "stable") {
        return;
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("webrtc-offer", {
        roomId: roomIdRef.current,
        offer: pc.localDescription,
      });

      callStartedRef.current = true;
      setStatus("Offer sent. Waiting for answer and ICE candidates.");
    } catch (err) {
      callStartedRef.current = false;
      setError(formatError(err));
      setStatus("Unable to start the call.");
    } finally {
      isMakingOfferRef.current = false;
    }
  }, [createPeerConnection, ensureLocalStream]);

  const createRoom = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("Socket.IO is not connected yet.");
      return;
    }

    setError("");
    socket.emit("create-room", null, (response) => {
      if (!response?.ok) {
        setError(response?.error ?? "Unable to create a room.");
        return;
      }

      const nextRoomCode = normalizeRoomCode(response.roomId);
      setRoomCode(nextRoomCode);
      roomIdRef.current = nextRoomCode;
      setJoinCode("");
      setIsHost(true);
      setRoomState("active");
      setConnectionState("waiting");
      callStartedRef.current = false;
      setStatus(`Room ${nextRoomCode} created. Share it with the second browser.`);
    });
  }, []);

  const joinRoom = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("Socket.IO is not connected yet.");
      return;
    }

    const roomToJoin = normalizeRoomCode(joinCode);
    if (!roomToJoin) {
      setError("Enter a room code first.");
      return;
    }

    setError("");
    socket.emit("join-room", { roomId: roomToJoin }, (response) => {
      if (!response?.ok) {
        setError(response?.error ?? "Unable to join the room.");
        return;
      }

      const nextRoomCode = normalizeRoomCode(response.roomId);
      setRoomCode(nextRoomCode);
      roomIdRef.current = nextRoomCode;
      setIsHost(false);
      setRoomState("active");
      setConnectionState("waiting");
      callStartedRef.current = false;
      setStatus(`Joined room ${nextRoomCode}. Waiting for the host to start the call.`);
    });
  }, [joinCode]);

  const leaveRoom = useCallback(() => {
    const socket = socketRef.current;
    const activeRoomId = roomIdRef.current;

    if (socket?.connected && activeRoomId) {
      socket.emit("leave-room", { roomId: activeRoomId });
    }

    clearSession("Left the room.");
  }, [clearSession]);

  const startCamera = useCallback(async () => {
    try {
      setError("");
      await ensureLocalStream();
    } catch (err) {
      setError(formatError(err));
      setStatus("Camera access was not granted.");
    }
  }, [ensureLocalStream]);

  const stopCamera = useCallback(() => {
    stopLocalStream();
    setStatus("Camera stopped.");
  }, [stopLocalStream]);

  const copyRoomCode = useCallback(async () => {
    const code = roomCodeRef.current;
    if (!code) {
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setStatus("Room code copied to clipboard.");
    } catch (err) {
      setError(formatError(err));
    }
  }, []);

  const socketStatusMeta = useMemo(() => getSocketStatusMeta(socketState), [socketState]);
  const peerStatusMeta = useMemo(() => getPeerStatusMeta(connectionState), [connectionState]);
  const visibleRoomCode = roomState === "disconnected" ? endedRoomCode : roomCode;
  const roomMode = isHost ? "Host" : roomCode ? "Guest" : "Ready";
  const roomStatusLabel =
    roomState === "disconnected" ? "Disconnected" : isHost ? "Host" : roomCode ? "Joined" : "Idle";

  const permissionCards = [
    {
      id: "camera",
      label: "Camera",
      value: cameraPermission,
      action: requestCameraPermission,
      actionLabel: "Request camera",
    },
    {
      id: "microphone",
      label: "Microphone",
      value: microphonePermission,
      action: requestMicrophonePermission,
      actionLabel: "Request mic",
    },
  ];

  useEffect(() => {
    const socket = io(socketUrl, {
      transports: ["websocket"],
    });

    socketRef.current = socket;
    console.log("Connecting Socket.IO", socketUrl);

    socket.on("connect", () => {
      setSocketState("connected");
      setStatus("Socket.IO connected. Create or join a room.");
    });

    socket.on("connect_error", (err) => {
      console.error("Socket.IO connect_error", err);
      setError(formatError(err));
      setSocketState("disconnected");
    });

    socket.on("disconnect", () => {
      setSocketState("disconnected");
      if (roomStateRef.current !== "disconnected") {
        setConnectionState("idle");
        setStatus("Socket.IO disconnected.");
      }
      closePeerConnection();
      resetRemoteStream();
    });

    socket.on("peer-joined", () => {
      if (isHostRef.current) {
        void startOffer();
      }
    });

    socket.on("webrtc-offer", ({ offer }) => {
      void handleOffer(offer);
    });

    socket.on("webrtc-answer", ({ answer }) => {
      void handleAnswer(answer);
    });

    socket.on("webrtc-ice-candidate", ({ candidate }) => {
      void handleIceCandidate(candidate);
    });

    socket.on("room-ended", ({ roomId }) => {
      setConnectionState("disconnected");
      setRoomState("disconnected");
      setEndedRoomCode(roomId || roomCodeRef.current || roomIdRef.current);
      clearSession("Call ended.");
    });

    return () => {
      socket.off("connect");
      socket.off("connect_error");
      socket.off("disconnect");
      socket.off("peer-joined");
      socket.off("webrtc-offer");
      socket.off("webrtc-answer");
      socket.off("webrtc-ice-candidate");
      socket.off("room-ended");
      socket.disconnect();
      closePeerConnection();
      resetRemoteStream();
    };
  }, [clearSession, closePeerConnection, handleAnswer, handleIceCandidate, handleOffer, resetRemoteStream, startOffer]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">WebRTC Studio</p>
          <h1>Responsive two-person video calling with clean signaling flow.</h1>
          <p className="hero-subtitle">
            Create a room, join from another device, and let Socket.IO handle offers, answers, and ICE candidates in
            the background.
          </p>
        </div>

        <div className="topbar-status">
          <span className={`status-dot state-${socketStatusMeta.tone}`} />
          <div>
            <p className="status-label">Socket</p>
            <p className={`status-value status-value-${socketStatusMeta.tone}`}>{socketStatusMeta.label}</p>
          </div>
        </div>
      </header>

      <section className="hero-panel">
        <div className="hero-copy">
          <div className="hero-badges">
            <span className={`hero-badge badge-${socketStatusMeta.tone}`}>Socket {socketStatusMeta.label}</span>
            <span className={`hero-badge badge-${peerStatusMeta.tone}`}>Peer {peerStatusMeta.label}</span>
            <span className="hero-badge badge-room">Room {roomCode || "not set"}</span>
          </div>

          <div className="status-card">
            <span className={`status-dot state-${peerStatusMeta.tone}`} />
            <div>
              <p className="status-label">Peer status</p>
              <p className="status-value" aria-live="polite">
                {status}
              </p>
            </div>
          </div>

          <div className="permission-grid">
            {permissionCards.map((card) => (
              <div className="permission-card" key={card.id}>
                <p className="permission-label">{card.label} Permission</p>
                <p className={`permission-value permission-${card.value}`}>{card.value}</p>
                <button type="button" className="secondary" onClick={card.action}>
                  {card.actionLabel}
                </button>
              </div>
            ))}
          </div>

          <div className="action-row">
            <button type="button" onClick={startCamera}>
              Start camera
            </button>
            <button type="button" className="secondary" onClick={createRoom}>
              Create room
            </button>
            <button type="button" className="secondary" onClick={leaveRoom}>
              Leave room
            </button>
            <button type="button" className="ghost" onClick={stopCamera}>
              Stop camera
            </button>
          </div>
        </div>

        <aside className="hero-art card-surface">
          <div className="hero-logo" aria-hidden="true">
            <img className="hero-logo-image" src={logoImage} alt="" />
          </div>
          <div className="hero-art-copy">
            <p className="eyebrow small">Session state</p>
            <h2>{roomMode} ready</h2>
            <p>
              A simple video-call emblem now anchors the panel, so the hero feels custom-built for meeting rooms
              instead of borrowed from an image file.
            </p>
          </div>

          <div className="mini-metrics">
            <div>
              <span className="metric-label">Socket</span>
              <strong>{socketState}</strong>
            </div>
            <div>
              <span className="metric-label">Peer</span>
              <strong>{connectionState}</strong>
            </div>
            <div>
              <span className="metric-label">Mode</span>
              <strong>{roomMode}</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="workspace-grid">
        <div className="video-stack">
          <div className="video-panel card-surface">
            <div className="panel-header">
              <div>
                <p className="eyebrow small">Preview</p>
                <h2>Local video</h2>
              </div>
              <button type="button" className="link-button" onClick={stopCamera}>
                Stop camera
              </button>
            </div>

            <div className="video-shell">
              <video ref={localVideoRef} autoPlay playsInline muted className="video-frame" />
              {!localStream ? <p className="video-empty">Your camera preview will appear here.</p> : null}
            </div>
          </div>

          <div className="video-panel card-surface">
            <div className="panel-header">
              <div>
                <p className="eyebrow small">Peer</p>
                <h2>Remote user</h2>
              </div>
              <p className={`connection-pill pill-${peerStatusMeta.tone}`}>{peerStatusMeta.label}</p>
            </div>

            <div className="video-shell">
              <video ref={remoteVideoRef} autoPlay playsInline className="video-frame remote" />
              {!remoteStream ? <p className="video-empty">Waiting for the second browser to connect.</p> : null}
            </div>
          </div>
        </div>

        <div className="room-panel card-surface">
          <div className="panel-header">
            <div>
              <p className="eyebrow small">Room</p>
              <h2>Join a call</h2>
            </div>
            <p
              className={`connection-pill ${
                roomState === "disconnected" ? "pill-disconnected" : isHost ? "host-pill" : "guest-pill"
              }`}
            >
              {roomStatusLabel}
            </p>
          </div>

          <div className="room-stack">
            <div className="room-card">
              <p className="room-card-label">Share code</p>
              <div className="room-readout">
                <span className="room-code room-code-display">{visibleRoomCode || "No room created yet."}</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={copyRoomCode}
                  disabled={!visibleRoomCode || roomState === "disconnected"}
                >
                  Copy room code
                </button>
              </div>
            </div>

            <div className="room-card">
              <p className="room-card-label">Join with code</p>
              <div className="room-field">
                <label className="field-label" htmlFor="join-code">
                  Room code to join
                </label>
                <input
                  id="join-code"
                  className="room-input"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  placeholder="Paste the code here"
                  spellCheck="false"
                />
              </div>

              <div className="room-actions">
                <button type="button" className="secondary" onClick={joinRoom}>
                  Join room
                </button>
              </div>
            </div>
          </div>

          <div className="room-summary">
            <div>
              <p className="status-label">Active room</p>
              <p className="room-code">
                {roomState === "disconnected" ? "Room Disconnected" : visibleRoomCode || "No room joined yet."}
              </p>
              <p className="room-summary-copy">
                The server only relays signaling. The media flows directly between the two browsers once the call is
                up.
              </p>
            </div>
          </div>

          <div className="room-guide">
            <h3>How it works</h3>
            <ol>
              <li>Open the app in two browsers or devices.</li>
              <li>Use the permission buttons to grant camera and microphone access.</li>
              <li>The host clicks Create room and shares the room code.</li>
              <li>The second user pastes the code and clicks Join room.</li>
              <li>Socket.IO relays the WebRTC offer, answer, and ICE candidates automatically.</li>
            </ol>
          </div>
        </div>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}
    </main>
  );
}

export default App;
