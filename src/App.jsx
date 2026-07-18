import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logoImage from './assets/LOGO.png';
import ChatBox from './components/ChatBox.jsx';
import CameraButton from './components/CameraButton.jsx';
import MuteButton from './components/MuteButton.jsx';
import ScreenShareButton from './components/ScreenShareButton.jsx';
import { useChat } from './hooks/useChat.js';
import { useMediaControls } from './hooks/useMediaControls.js';
import { useScreenShare } from './hooks/useScreenShare.js';
import { useTyping } from './hooks/useTyping.js';
import { destroyAppSocket, getAppSocket } from './services/socket.js';
import './App.css';

const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const socketUrl =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : window.location.origin;

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const FILE_CHUNK_SIZE = 64 * 1024;

function formatError(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Something went wrong.';
}

function normalizeRoomCode(code) {
  return code.trim().toUpperCase();
}

function createId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function getSocketStatusMeta(state) {
  if (state === 'connected') return { label: 'Online', tone: 'connected' };
  return { label: 'Offline', tone: 'disconnected' };
}

function getPeerStatusMeta(state) {
  if (state === 'connected') return { label: 'Connected', tone: 'connected' };
  if (state === 'connecting') return { label: 'Connecting', tone: 'waiting' };
  if (state === 'failed' || state === 'disconnected') return { label: 'Disconnected', tone: 'disconnected' };
  if (state === 'waiting' || state === 'idle') return { label: 'Waiting', tone: 'waiting' };
  return { label: state, tone: 'waiting' };
}

function createFallbackStream() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;

  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#07111d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#57d6ff';
    context.font = 'bold 42px Arial, sans-serif';
    context.textAlign = 'center';
    context.fillText('Virtual camera fallback', canvas.width / 2, canvas.height / 2 - 10);
    context.fillStyle = '#ecf4ff';
    context.font = '24px Arial, sans-serif';
    context.fillText('No physical camera or microphone detected', canvas.width / 2, canvas.height / 2 + 36);
  }

  return canvas.captureStream(15);
}

function isImageFile(fileType, fileName) {
  const normalizedName = (fileName || '').toLowerCase();
  return String(fileType || '').startsWith('image/') || /\.(png|jpg|jpeg|gif|webp)$/i.test(normalizedName);
}

function isSupportedAttachment(file) {
  if (!file) return false;

  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return (
    isImageFile(file.type, file.name) ||
    type === 'application/pdf' ||
    type.includes('word') ||
    type === 'application/zip' ||
    type === 'application/x-zip-compressed' ||
    type === 'application/x-zip' ||
    type === 'text/plain' ||
    /\.(pdf|doc|docx|zip|txt)$/i.test(name)
  );
}

function normalizeBinaryChunk(chunk) {
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
  }
  if (chunk && typeof chunk === 'object' && Array.isArray(chunk.data)) {
    return new Uint8Array(chunk.data);
  }
  return null;
}

async function waitForDataChannelDrain(channel) {
  while (channel.readyState === 'open' && channel.bufferedAmount > 4 * 1024 * 1024) {
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
}

function App() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(new MediaStream());
  const roomIdRef = useRef('');
  const roomCodeRef = useRef('');
  const roomStateRef = useRef('idle');
  const isHostRef = useRef(false);
  const callStartedRef = useRef(false);
  const isMakingOfferRef = useRef(false);
  const pendingIceCandidatesRef = useRef([]);
  const fileQueueRef = useRef(Promise.resolve());
  const incomingFilesRef = useRef(new Map());
  const activeIncomingFileIdRef = useRef(null);
  const objectUrlRef = useRef(new Set());

  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [status, setStatus] = useState('Connect to Socket.IO to start.');
  const [socketState, setSocketState] = useState('disconnected');
  const [connectionState, setConnectionState] = useState('idle');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [roomState, setRoomState] = useState('idle');
  const [cameraPermission, setCameraPermission] = useState('idle');
  const [microphonePermission, setMicrophonePermission] = useState('idle');
  const [endedRoomCode, setEndedRoomCode] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [peerAudioEnabled, setPeerAudioEnabled] = useState(true);
  const [peerVideoEnabled, setPeerVideoEnabled] = useState(true);
  const [peerScreenSharing, setPeerScreenSharing] = useState(false);

  const {
    messages,
    appendMessage,
    updateMessage,
    clearChat,
    peerTyping,
    setPeerTypingIndicator,
    unreadCount,
    markChatRead,
    messagesEndRef,
  } = useChat();

  const { handleInputChange, stopTyping } = useTyping();

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

  const emitTyping = useCallback(() => {
    const socket = socketRef.current;
    const roomId = roomIdRef.current;
    if (socket && socket.connected && roomId) {
      socket.emit('typing', { roomId: roomId, senderName: 'You' });
    }
  }, []);

  const emitStopTyping = useCallback(() => {
    const socket = socketRef.current;
    const roomId = roomIdRef.current;
    if (socket && socket.connected && roomId) {
      socket.emit('stop-typing', { roomId: roomId, senderName: 'You' });
    }
  }, []);

  const stopLocalStream = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setCameraPermission('idle');
    setMicrophonePermission('idle');
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  }, []);

  const resetRemoteStream = useCallback(() => {
    remoteStreamRef.current = new MediaStream();
    setRemoteStream(null);
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, []);

  const closeDataChannel = useCallback(() => {
    const channel = dataChannelRef.current;
    if (!channel) return;

    channel.onopen = null;
    channel.onclose = null;
    channel.onerror = null;
    channel.onmessage = null;

    try {
      channel.close();
    } catch (err) {
      console.error('Failed to close data channel', err);
    }

    dataChannelRef.current = null;
  }, []);

  const closePeerConnection = useCallback(() => {
    const pc = peerConnectionRef.current;
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onsignalingstatechange = null;
      pc.ondatachannel = null;
      pc.close();
      peerConnectionRef.current = null;
    }

    closeDataChannel();
    isMakingOfferRef.current = false;
    pendingIceCandidatesRef.current = [];
  }, [closeDataChannel]);

  const clearSession = useCallback(
    (nextStatus, options) => {
      const opts = options || {};
      const socket = socketRef.current;
      const activeRoomId = roomIdRef.current;

      if (socket && socket.connected && activeRoomId) {
        socket.emit('stop-typing', { roomId: activeRoomId, senderName: 'You' });
      }

      callStartedRef.current = false;
      setRoomCode('');
      setJoinCode('');
      setIsHost(false);
      setRoomState('idle');
      setConnectionState('idle');
      setDraft('');
      setPeerAudioEnabled(true);
      setPeerVideoEnabled(true);
      setPeerScreenSharing(false);
      incomingFilesRef.current.clear();
      activeIncomingFileIdRef.current = null;
      roomIdRef.current = '';

      if (!opts.preserveEndedRoomCode) {
        setEndedRoomCode('');
      }

      closePeerConnection();
      resetRemoteStream();
      stopLocalStream();
      clearChat();
      setStatus(nextStatus || 'Connect to Socket.IO to start.');
    },
    [clearChat, closePeerConnection, resetRemoteStream, stopLocalStream],
  );

  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
      setCameraPermission('granted');
      setMicrophonePermission('granted');
      return localStreamRef.current;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraPermission('granted');
      setMicrophonePermission('granted');
      setStatus('Camera and microphone are ready.');
      return stream;
    } catch (err) {
      if (err && err.name === 'NotAllowedError') {
        setCameraPermission('denied');
        setMicrophonePermission('denied');
        throw err;
      }

      const fallbackStream = createFallbackStream();
      localStreamRef.current = fallbackStream;
      setLocalStream(fallbackStream);
      setCameraPermission('granted');
      setMicrophonePermission('denied');
      setStatus('Using virtual fallback camera stream.');
      return fallbackStream;
    }
  }, []);

  const requestCameraPermission = useCallback(async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((track) => track.stop());
      setCameraPermission('granted');
      setStatus('Camera permission granted.');
    } catch (err) {
      setCameraPermission('denied');
      setError(formatError(err));
      setStatus('Camera permission denied.');
    }
  }, []);

  const requestMicrophonePermission = useCallback(async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophonePermission('granted');
      setStatus('Microphone permission granted.');
    } catch (err) {
      setMicrophonePermission('denied');
      setError(formatError(err));
      setStatus('Microphone permission denied.');
    }
  }, []);

  const drainPendingIceCandidates = useCallback(async (pc) => {
    const queuedCandidates = pendingIceCandidatesRef.current;
    pendingIceCandidatesRef.current = [];

    for (const candidate of queuedCandidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.error('Failed to add queued ICE candidate', err);
      }
    }
  }, []);
  const handleIncomingFileReady = useCallback(
    (payload, transport) => {
      if (!payload || !payload.fileId) return null;

      const fileId = payload.fileId;
      const existing = incomingFilesRef.current.get(fileId);

      if (existing) {
        existing.fileName = payload.fileName || existing.fileName;
        existing.fileSize = payload.fileSize != null ? payload.fileSize : existing.fileSize;
        existing.fileType = payload.fileType || existing.fileType;
        existing.transport = transport || existing.transport;
        existing.senderName = payload.senderName || existing.senderName;
        return fileId;
      }

      const message = appendMessage(
        {
          id: fileId,
          type: 'file',
          senderName: payload.senderName || 'Peer',
          text: '',
          outgoing: false,
          time: payload.time || new Date().toISOString(),
          status: 'receiving',
          fileId: fileId,
          fileName: payload.fileName || 'file',
          fileSize: payload.fileSize != null ? payload.fileSize : 0,
          fileType: payload.fileType || '',
        },
        { incoming: true },
      );

      incomingFilesRef.current.set(fileId, {
        messageId: message.id,
        fileName: payload.fileName || 'file',
        fileSize: payload.fileSize != null ? payload.fileSize : 0,
        fileType: payload.fileType || '',
        senderName: payload.senderName || 'Peer',
        chunks: [],
        transport: transport || 'socket',
      });

      return fileId;
    },
    [appendMessage],
  );

  const finalizeIncomingFile = useCallback(
    (fileId) => {
      const transfer = incomingFilesRef.current.get(fileId);
      if (!transfer) return;

      const blob = new Blob(transfer.chunks, {
        type: transfer.fileType || 'application/octet-stream',
      });
      const fileUrl = URL.createObjectURL(blob);
      objectUrlRef.current.add(fileUrl);

      updateMessage(transfer.messageId, {
        status: 'received',
        fileUrl: fileUrl,
        previewUrl: isImageFile(transfer.fileType, transfer.fileName) ? fileUrl : undefined,
      });

      incomingFilesRef.current.delete(fileId);
      if (activeIncomingFileIdRef.current === fileId) activeIncomingFileIdRef.current = null;
    },
    [updateMessage],
  );

  const handleDataChannelMessage = useCallback(
    (event) => {
      const data = event.data;

      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          if (parsed.kind === 'file-meta') {
            const fileId = handleIncomingFileReady(
              {
                fileId: parsed.fileId,
                fileName: parsed.fileName,
                fileSize: parsed.fileSize,
                fileType: parsed.fileType,
                senderName: 'Peer',
                time: new Date().toISOString(),
              },
              'datachannel',
            );
            activeIncomingFileIdRef.current = fileId;
            return;
          }

          if (parsed.kind === 'file-end') {
            finalizeIncomingFile(parsed.fileId || activeIncomingFileIdRef.current);
            return;
          }
        } catch {
          return;
        }
      }

      const fileId = activeIncomingFileIdRef.current;
      if (!fileId) return;

      const transfer = incomingFilesRef.current.get(fileId);
      if (!transfer) return;

      const chunk = normalizeBinaryChunk(data);
      if (chunk) transfer.chunks.push(chunk);
    },
    [finalizeIncomingFile, handleIncomingFileReady],
  );

  const setupDataChannel = useCallback(
    (channel) => {
      if (!channel) return;

      dataChannelRef.current = channel;
      channel.onopen = function () {
        setStatus('Peer data channel is ready.');
      };
      channel.onclose = function () {
        if (dataChannelRef.current === channel) dataChannelRef.current = null;
      };
      channel.onerror = function () {
        setStatus('Data channel error.');
      };
      channel.onmessage = function (event) {
        void handleDataChannelMessage(event);
      };
    },
    [handleDataChannelMessage],
  );

  const createPeerConnection = useCallback(
    (stream) => {
      const existingPc = peerConnectionRef.current;
      if (existingPc && existingPc.signalingState !== 'closed') {
        const senderTrackIds = new Set(existingPc.getSenders().map((sender) => sender.track && sender.track.id).filter(Boolean));
        stream.getTracks().forEach((track) => {
          if (!senderTrackIds.has(track.id)) existingPc.addTrack(track, stream);
        });
        return existingPc;
      }

      const pc = new RTCPeerConnection(rtcConfig);

      const resolveState = function () {
        if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          return 'connected';
        }
        if (pc.connectionState === 'connecting' || pc.iceConnectionState === 'checking') return 'connecting';
        if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') return 'failed';
        if (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected') return 'disconnected';
        return roomIdRef.current ? 'waiting' : 'idle';
      };

      const syncPeerState = function () {
        const nextState = resolveState();
        setConnectionState(nextState);

        if (nextState === 'connected') setStatus('Peer connected.');
        else if (nextState === 'connecting') setStatus('Peer is connecting...');
        else if (nextState === 'failed') setStatus('Connection failed. Try leaving the room and creating a new one.');
        else if (nextState === 'disconnected') setStatus('The peer disconnected. Waiting for someone else to join.');
      };

      pc.ontrack = function (event) {
        const incomingStream = event.streams[0];
        const remoteStreamInstance = remoteStreamRef.current;
        const tracks = incomingStream && incomingStream.getTracks ? incomingStream.getTracks() : [event.track].filter(Boolean);

        tracks.forEach(function (track) {
          const alreadyAdded = remoteStreamInstance.getTracks().some(function (existingTrack) {
            return existingTrack.id === track.id;
          });
          if (!alreadyAdded) remoteStreamInstance.addTrack(track);
        });

        const nextRemoteStream = new MediaStream(remoteStreamInstance.getTracks());
        remoteStreamRef.current = nextRemoteStream;
        setRemoteStream(nextRemoteStream);

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = nextRemoteStream;
          void remoteVideoRef.current.play().catch(function () {});
        }
      };

      pc.onicecandidate = function (event) {
        if (!event.candidate) return;
        if (socketRef.current && socketRef.current.connected && roomIdRef.current) {
          socketRef.current.emit('webrtc-ice-candidate', {
            roomId: roomIdRef.current,
            candidate: event.candidate,
          });
        }
      };

      pc.onconnectionstatechange = syncPeerState;
      pc.oniceconnectionstatechange = syncPeerState;
      pc.ondatachannel = function (event) {
        setupDataChannel(event.channel);
      };

      stream.getTracks().forEach(function (track) {
        pc.addTrack(track, stream);
      });

      if (isHostRef.current) {
        setupDataChannel(pc.createDataChannel('meeting-files', { ordered: true }));
      }

      peerConnectionRef.current = pc;
      return pc;
    },
    [setupDataChannel],
  );

  const handleOffer = useCallback(
    async (offer) => {
      if (!offer) return;

      const stream = await ensureLocalStream();
      const pc = createPeerConnection(stream);

      await pc.setRemoteDescription(offer);
      await drainPendingIceCandidates(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (socketRef.current) {
        socketRef.current.emit('webrtc-answer', {
          roomId: roomIdRef.current,
          answer: pc.localDescription,
        });
      }

      callStartedRef.current = true;
      setStatus('Answer sent. Exchanging ICE candidates...');
    },
    [createPeerConnection, drainPendingIceCandidates, ensureLocalStream],
  );

  const handleAnswer = useCallback(
    async (answer) => {
      if (!answer) return;

      const stream = await ensureLocalStream();
      const pc = createPeerConnection(stream);

      await pc.setRemoteDescription(answer);
      await drainPendingIceCandidates(pc);
      callStartedRef.current = true;
      setStatus('Answer received. Exchanging ICE candidates...');
    },
    [createPeerConnection, drainPendingIceCandidates, ensureLocalStream],
  );

  const handleIceCandidate = useCallback(async (candidate) => {
    if (!candidate) return;

    const pc = peerConnectionRef.current;
    if (!pc || !pc.remoteDescription) {
      pendingIceCandidatesRef.current.push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.error('Failed to add ICE candidate', err);
    }
  }, []);

  const startOffer = useCallback(async () => {
    if (callStartedRef.current || isMakingOfferRef.current) return;

    try {
      isMakingOfferRef.current = true;
      setError('');

      const socket = socketRef.current;
      if (!socket || !socket.connected) throw new Error('Socket.IO is not connected yet.');
      if (!roomIdRef.current) throw new Error('Create or join a room first.');

      const stream = await ensureLocalStream();
      const pc = createPeerConnection(stream);
      if (pc.signalingState !== 'stable') return;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('webrtc-offer', {
        roomId: roomIdRef.current,
        offer: pc.localDescription,
      });

      callStartedRef.current = true;
      setStatus('Offer sent. Waiting for answer and ICE candidates.');
    } catch (err) {
      callStartedRef.current = false;
      setError(formatError(err));
      setStatus('Unable to start the call.');
    } finally {
      isMakingOfferRef.current = false;
    }
  }, [createPeerConnection, ensureLocalStream]);

  const createRoom = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setError('Socket.IO is not connected yet.');
      return;
    }

    setError('');
    socket.emit('create-room', null, function (response) {
      if (!response || !response.ok) {
        setError((response && response.error) || 'Unable to create a room.');
        return;
      }

      const nextRoomCode = normalizeRoomCode(response.roomId);
      setRoomCode(nextRoomCode);
      roomIdRef.current = nextRoomCode;
      setJoinCode('');
      setIsHost(true);
      setRoomState('active');
      setConnectionState('waiting');
      callStartedRef.current = false;
      setStatus('Room ' + nextRoomCode + ' created. Share it with the second browser.');
    });
  }, []);

  const joinRoom = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setError('Socket.IO is not connected yet.');
      return;
    }

    const roomToJoin = normalizeRoomCode(joinCode);
    if (!roomToJoin) {
      setError('Enter a room code first.');
      return;
    }

    setError('');
    socket.emit('join-room', { roomId: roomToJoin }, function (response) {
      if (!response || !response.ok) {
        setError((response && response.error) || 'Unable to join the room.');
        return;
      }

      const nextRoomCode = normalizeRoomCode(response.roomId);
      setRoomCode(nextRoomCode);
      roomIdRef.current = nextRoomCode;
      setIsHost(false);
      setRoomState('active');
      setConnectionState('waiting');
      callStartedRef.current = false;
      setStatus('Joined room ' + nextRoomCode + '. Waiting for the host to start the call.');
    });
  }, [joinCode]);

  const leaveRoom = useCallback(() => {
    const socket = socketRef.current;
    const activeRoomId = roomIdRef.current;
    if (socket && socket.connected && activeRoomId) {
      socket.emit('leave-room', { roomId: activeRoomId });
    }
    clearSession('Left the room.');
  }, [clearSession]);

  const startCamera = useCallback(async () => {
    try {
      setError('');
      await ensureLocalStream();
    } catch (err) {
      setError(formatError(err));
      setStatus('Camera access was not granted.');
    }
  }, [ensureLocalStream]);

  const stopCamera = useCallback(() => {
    stopLocalStream();
    setStatus('Camera stopped.');
  }, [stopLocalStream]);

  const copyRoomCode = useCallback(async () => {
    const code = roomCodeRef.current;
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      setStatus('Room code copied to clipboard.');
    } catch (err) {
      setError(formatError(err));
    }
  }, []);

  const handleRemoteTyping = useCallback(() => {
    setPeerTypingIndicator(true);
  }, [setPeerTypingIndicator]);

  const handleRemoteStopTyping = useCallback(() => {
    setPeerTypingIndicator(false);
  }, [setPeerTypingIndicator]);

  const handleRemoteAudioToggle = useCallback((payload) => {
    if (payload && typeof payload.enabled === 'boolean') setPeerAudioEnabled(payload.enabled);
  }, []);

  const handleRemoteVideoToggle = useCallback((payload) => {
    if (payload && typeof payload.enabled === 'boolean') setPeerVideoEnabled(payload.enabled);
  }, []);

  const handleRemoteScreenShareStart = useCallback(() => {
    setPeerScreenSharing(true);
  }, []);

  const handleRemoteScreenShareStop = useCallback(() => {
    setPeerScreenSharing(false);
  }, []);

  const handleReceiveMessage = useCallback(
    (payload) => {
      if (!payload || !payload.message || !payload.message.trim()) return;

      appendMessage(
        {
          id: payload.id || createId('msg'),
          type: 'text',
          senderName: payload.senderName || 'Peer',
          text: payload.message,
          outgoing: false,
          time: payload.time || new Date().toISOString(),
        },
        { incoming: true },
      );
    },
    [appendMessage],
  );

  const handleSocketFileUpload = useCallback(
    (payload) => {
      if (!payload || !payload.fileId) return;

      if (payload.transfer === 'meta') {
        const fileId = handleIncomingFileReady(payload, payload.transport || 'socket');
        if (payload.transport === 'datachannel') activeIncomingFileIdRef.current = fileId;
        return;
      }

      if (payload.transfer === 'chunk') {
        const transfer = incomingFilesRef.current.get(payload.fileId);
        if (!transfer) return;

        const chunk = normalizeBinaryChunk(payload.chunk);
        if (chunk) transfer.chunks.push(chunk);
        return;
      }

      if (payload.transfer === 'end') {
        finalizeIncomingFile(payload.fileId);
      }
    },
    [finalizeIncomingFile, handleIncomingFileReady],
  );

  const sendFileViaSocket = useCallback(async (fileId, file) => {
    const socket = socketRef.current;
    const roomId = roomIdRef.current;
    if (!socket || !socket.connected || !roomId) throw new Error('Join a room before sending files.');

    const buffer = await file.arrayBuffer();
    const totalChunks = Math.max(1, Math.ceil(buffer.byteLength / FILE_CHUNK_SIZE));

    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * FILE_CHUNK_SIZE;
      const end = Math.min(start + FILE_CHUNK_SIZE, buffer.byteLength);
      socket.emit('file-upload', {
        roomId: roomId,
        fileId: fileId,
        transfer: 'chunk',
        index: index,
        totalChunks: totalChunks,
        chunk: buffer.slice(start, end),
      });
    }

    socket.emit('file-upload', {
      roomId: roomId,
      fileId: fileId,
      transfer: 'end',
    });
  }, []);
  const sendFileViaDataChannel = useCallback(async (fileId, file) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') throw new Error('Data channel is not ready.');

    const buffer = await file.arrayBuffer();
    const totalChunks = Math.max(1, Math.ceil(buffer.byteLength / FILE_CHUNK_SIZE));

    channel.send(JSON.stringify({
      kind: 'file-meta',
      fileId: fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      totalChunks: totalChunks,
    }));

    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * FILE_CHUNK_SIZE;
      const end = Math.min(start + FILE_CHUNK_SIZE, buffer.byteLength);
      await waitForDataChannelDrain(channel);
      channel.send(buffer.slice(start, end));
    }

    await waitForDataChannelDrain(channel);
    channel.send(JSON.stringify({ kind: 'file-end', fileId: fileId }));
  }, []);

  const sendMessage = useCallback(() => {
    const text = draft.trim();
    if (!text) return;

    const socket = socketRef.current;
    const roomId = roomIdRef.current;
    if (!socket || !socket.connected || !roomId) {
      setError('Join a room before sending messages.');
      return;
    }

    const time = new Date().toISOString();
    appendMessage({
      id: createId('msg'),
      type: 'text',
      senderName: 'You',
      text: text,
      outgoing: true,
      time: time,
    });

    socket.emit('chat-message', {
      roomId: roomId,
      message: text,
      senderName: 'You',
      time: time,
    });

    setDraft('');
    stopTyping(emitStopTyping);
    markChatRead();
  }, [appendMessage, draft, emitStopTyping, markChatRead, stopTyping]);

  const handleDraftChange = useCallback(
    (value) => {
      setDraft(value);
      handleInputChange(value, emitTyping, emitStopTyping);
    },
    [emitStopTyping, emitTyping, handleInputChange],
  );

  const handleDraftFocus = useCallback(() => {
    markChatRead();
  }, [markChatRead]);

  const handleDraftBlur = useCallback(() => {
    stopTyping(emitStopTyping);
  }, [emitStopTyping, stopTyping]);

  const handleEmojiClick = useCallback(() => {
    setStatus('Emoji picker placeholder.');
  }, []);

  const handleFileAttach = useCallback(
    (file) => {
      if (!file) return;

      if (file.size > MAX_FILE_SIZE) {
        setError('Files must be 20 MB or smaller.');
        return;
      }

      if (!isSupportedAttachment(file)) {
        setError('Supported files are images, PDF, Word, ZIP, and TXT.');
        return;
      }

      const socket = socketRef.current;
      const roomId = roomIdRef.current;
      const transport = dataChannelRef.current && dataChannelRef.current.readyState === 'open' ? 'datachannel' : 'socket';

      if (!socket || !socket.connected || !roomId) {
        setError('Join a room before sending files.');
        return;
      }

      const fileId = createId('file');
      const time = new Date().toISOString();
      const localFileUrl = URL.createObjectURL(file);
      objectUrlRef.current.add(localFileUrl);

      const message = appendMessage({
        id: fileId,
        type: 'file',
        senderName: 'You',
        text: '',
        outgoing: true,
        time: time,
        status: 'sending',
        fileId: fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        fileUrl: localFileUrl,
        previewUrl: isImageFile(file.type, file.name) ? localFileUrl : undefined,
      });

      socket.emit('file-upload', {
        roomId: roomId,
        fileId: fileId,
        transfer: 'meta',
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        senderName: 'You',
        time: time,
        transport: transport,
      });

      fileQueueRef.current = fileQueueRef.current
        .then(async () => {
          if (transport === 'datachannel') {
            await sendFileViaDataChannel(fileId, file);
          } else {
            await sendFileViaSocket(fileId, file);
          }
          updateMessage(message.id, { status: 'sent' });
          setStatus('Sent ' + file.name + '.');
        })
        .catch((err) => {
          updateMessage(message.id, { status: 'failed' });
          setError(formatError(err));
          setStatus('File transfer failed.');
        });
    },
    [appendMessage, sendFileViaDataChannel, sendFileViaSocket, updateMessage],
  );

  const socketStatusMeta = useMemo(() => getSocketStatusMeta(socketState), [socketState]);
  const peerStatusMeta = useMemo(() => getPeerStatusMeta(connectionState), [connectionState]);
  const visibleRoomCode = roomState === 'disconnected' ? endedRoomCode : roomCode;
  const roomMode = isHost ? 'Host' : roomCode ? 'Guest' : 'Ready';
  const roomStatusLabel = roomState === 'disconnected' ? 'Disconnected' : isHost ? 'Host' : roomCode ? 'Joined' : 'Idle';
  const peerMediaSummary =
    (peerAudioEnabled ? 'Mic on' : 'Muted') +
    ' · ' +
    (peerVideoEnabled ? 'Camera on' : 'Camera off') +
    (peerScreenSharing ? ' · Sharing screen' : '');

  const permissionCards = [
    {
      id: 'camera',
      label: 'Camera',
      value: cameraPermission,
      action: requestCameraPermission,
      actionLabel: 'Request camera',
    },
    {
      id: 'microphone',
      label: 'Microphone',
      value: microphonePermission,
      action: requestMicrophonePermission,
      actionLabel: 'Request mic',
    },
  ];

  useEffect(() => {
    const socket = getAppSocket(socketUrl);
    socketRef.current = socket;

    const handleConnect = function () {
      setSocketState('connected');
      setStatus('Socket.IO connected. Create or join a room.');
    };

    const handleConnectError = function (err) {
      setError(formatError(err));
      setSocketState('disconnected');
    };

    const handleDisconnect = function () {
      setSocketState('disconnected');
      if (roomStateRef.current !== 'disconnected') {
        setConnectionState('idle');
        setStatus('Socket.IO disconnected.');
      }
      closePeerConnection();
      resetRemoteStream();
    };

    const handlePeerJoined = function () {
      if (isHostRef.current) {
        void startOffer();
      }
    };

    const handleRoomEnded = function (payload) {
      setConnectionState('disconnected');
      setRoomState('disconnected');
      setEndedRoomCode((payload && payload.roomId) || roomCodeRef.current || roomIdRef.current);
      clearSession('Call ended.', { preserveEndedRoomCode: true });
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('disconnect', handleDisconnect);
    socket.on('peer-joined', handlePeerJoined);
    socket.on('webrtc-offer', function (payload) { void handleOffer(payload.offer); });
    socket.on('webrtc-answer', function (payload) { void handleAnswer(payload.answer); });
    socket.on('webrtc-ice-candidate', function (payload) { void handleIceCandidate(payload.candidate); });
    socket.on('receive-message', handleReceiveMessage);
    socket.on('typing', handleRemoteTyping);
    socket.on('stop-typing', handleRemoteStopTyping);
    socket.on('audio-toggle', handleRemoteAudioToggle);
    socket.on('video-toggle', handleRemoteVideoToggle);
    socket.on('screen-share-start', handleRemoteScreenShareStart);
    socket.on('screen-share-stop', handleRemoteScreenShareStop);
    socket.on('file-upload', handleSocketFileUpload);
    socket.on('room-ended', handleRoomEnded);

    return function () {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('disconnect', handleDisconnect);
      socket.off('peer-joined', handlePeerJoined);
      socket.off('webrtc-offer');
      socket.off('webrtc-answer');
      socket.off('webrtc-ice-candidate');
      socket.off('receive-message', handleReceiveMessage);
      socket.off('typing', handleRemoteTyping);
      socket.off('stop-typing', handleRemoteStopTyping);
      socket.off('audio-toggle', handleRemoteAudioToggle);
      socket.off('video-toggle', handleRemoteVideoToggle);
      socket.off('screen-share-start', handleRemoteScreenShareStart);
      socket.off('screen-share-stop', handleRemoteScreenShareStop);
      socket.off('file-upload', handleSocketFileUpload);
      socket.off('room-ended', handleRoomEnded);
      closePeerConnection();
      resetRemoteStream();
      destroyAppSocket();
    };
  }, [
    clearSession,
    closePeerConnection,
    handleAnswer,
    handleIceCandidate,
    handleOffer,
    handleReceiveMessage,
    handleRemoteAudioToggle,
    handleRemoteScreenShareStart,
    handleRemoteScreenShareStop,
    handleRemoteStopTyping,
    handleRemoteTyping,
    handleRemoteVideoToggle,
    handleSocketFileUpload,
    resetRemoteStream,
    startOffer,
  ]);

const mediaControls = useMediaControls({
    localStreamRef: localStreamRef,
    socketRef: socketRef,
    roomIdRef: roomIdRef,
    setStatus: setStatus,
  });

  const screenShareControls = useScreenShare({
    localStreamRef: localStreamRef,
    localVideoRef: localVideoRef,
    peerConnectionRef: peerConnectionRef,
    socketRef: socketRef,
    roomIdRef: roomIdRef,
    setStatus: setStatus,
  });

  const isMuted = mediaControls.isMuted;
  const isCameraOff = mediaControls.isCameraOff;
  const toggleMute = mediaControls.toggleMute;
  const toggleCamera = mediaControls.toggleCamera;
  const isScreenSharing = screenShareControls.isScreenSharing;
  const shareScreen = screenShareControls.shareScreen;
  const stopScreenShare = screenShareControls.stopScreenShare;

useEffect(() => {
    const createdUrls = objectUrlRef.current;
    return function () {
      createdUrls.forEach(function (url) {
        URL.revokeObjectURL(url);
      });
      createdUrls.clear();
    };
  }, []);
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">WebRTC Studio</p>
          <h1>Meet, chat, share files, and present your screen in one clean room.</h1>
          <p className="hero-subtitle">
            Create a room, join from another device, and keep the call alive with Socket.IO signaling, live chat,
            typing status, file delivery, and media controls.
          </p>
        </div>

        <div className="topbar-status">
          <span className={"status-dot state-" + socketStatusMeta.tone} />
          <div>
            <p className="status-label">Socket</p>
            <p className={"status-value status-value-" + socketStatusMeta.tone}>{socketStatusMeta.label}</p>
          </div>
        </div>
      </header>

      <section className="hero-panel">
        <div className="hero-copy">
          <div className="hero-badges">
            <span className={"hero-badge badge-" + socketStatusMeta.tone}>Socket {socketStatusMeta.label}</span>
            <span className={"hero-badge badge-" + peerStatusMeta.tone}>Peer {peerStatusMeta.label}</span>
            <span className="hero-badge badge-room">Room {visibleRoomCode || 'not set'}</span>
            <span className="hero-badge badge-room">Unread {unreadCount}</span>
          </div>

          <div className="status-card">
            <span className={"status-dot state-" + peerStatusMeta.tone} />
            <div>
              <p className="status-label">Peer status</p>
              <p className="status-value" aria-live="polite">{status}</p>
            </div>
          </div>

          <div className="permission-grid">
            {permissionCards.map(function (card) {
              return (
                <div className="permission-card" key={card.id}>
                  <p className="permission-label">{card.label} Permission</p>
                  <p className={"permission-value permission-" + card.value}>{card.value}</p>
                  <button type="button" className="secondary" onClick={card.action}>
                    {card.actionLabel}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="action-row">
            <button type="button" onClick={startCamera}>Start camera</button>
            <button type="button" className="secondary" onClick={createRoom}>Create room</button>
            <button type="button" className="secondary" onClick={leaveRoom}>Leave room</button>
            <button type="button" className="ghost" onClick={stopCamera}>Stop camera</button>
          </div>
        </div>

        <aside className="hero-art card-surface">
          <div className="hero-logo" aria-hidden="true">
            <img className="hero-logo-image" src={logoImage} alt="" />
          </div>
          <div className="hero-art-copy">
            <p className="eyebrow small">Session state</p>
            <h2>{roomMode} ready</h2>
            <p>A modern room for one-to-one calls, with direct media exchange and room-scoped chat layered on top.</p>
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
              <span className="metric-label">Media</span>
              <strong>{peerMediaSummary}</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="workspace-grid">
        <div className="main-column">
          <div className="video-panel card-surface">
            <div className="panel-header">
              <div>
                <p className="eyebrow small">Preview</p>
                <h2>Local video</h2>
              </div>
              <div className="panel-chips">
                <span className={"connection-pill " + (isMuted ? 'pill-disconnected' : 'pill-connected')}>
                  {isMuted ? 'Muted' : 'Mic live'}
                </span>
                <span className={"connection-pill " + (isCameraOff ? 'pill-disconnected' : 'pill-connected')}>
                  {isCameraOff ? 'Camera off' : 'Camera live'}
                </span>
              </div>
            </div>

            <div className="video-shell">
              <video ref={localVideoRef} autoPlay playsInline muted className="video-frame" />
              {!localStream ? <p className="video-empty">Your camera preview will appear here.</p> : null}
              <div className="video-overlay">
                <div className="control-strip">
                  <MuteButton muted={isMuted} onClick={toggleMute} />
                  <CameraButton off={isCameraOff} onClick={toggleCamera} />
                  <ScreenShareButton active={isScreenSharing} onClick={isScreenSharing ? stopScreenShare : shareScreen} />
                </div>
              </div>
            </div>
          </div>

          <div className="communication-panel">
            <div className="video-panel card-surface remote-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow small">Peer</p>
                  <h2>Remote user</h2>
                </div>
                <div className="panel-chips">
                  <p className={"connection-pill pill-" + peerStatusMeta.tone}>{peerStatusMeta.label}</p>
                  <p className={"connection-pill " + (peerScreenSharing ? 'host-pill' : 'guest-pill')}>
                    {peerScreenSharing ? 'Sharing screen' : 'Camera view'}
                  </p>
                </div>
              </div>

              <div className="video-shell">
                <video ref={remoteVideoRef} autoPlay playsInline className="video-frame remote" />
                {!remoteStream ? <p className="video-empty">Waiting for the second browser to connect.</p> : null}
                <div className="remote-badges">
                  <span className={"hero-badge " + (peerAudioEnabled ? 'badge-connected' : 'badge-waiting')}>
                    {peerAudioEnabled ? 'Mic on' : 'Mic muted'}
                  </span>
                  <span className={"hero-badge " + (peerVideoEnabled ? 'badge-connected' : 'badge-waiting')}>
                    {peerVideoEnabled ? 'Camera on' : 'Camera off'}
                  </span>
                  <span className="hero-badge badge-room">{peerMediaSummary}</span>
                </div>
              </div>
            </div>

            <ChatBox
              messages={messages}
              draft={draft}
              onDraftChange={handleDraftChange}
              onSendMessage={sendMessage}
              onAttachFile={handleFileAttach}
              onEmojiClick={handleEmojiClick}
              peerTyping={peerTyping}
              unreadCount={unreadCount}
              messagesEndRef={messagesEndRef}
              onFocus={handleDraftFocus}
              onBlur={handleDraftBlur}
              peerName="Peer"
            />
          </div>
        </div>

        <div className="room-panel card-surface">
          <div className="panel-header">
            <div>
              <p className="eyebrow small">Room</p>
              <h2>Join a call</h2>
            </div>
            <p
              className={
                'connection-pill ' +
                (roomState === 'disconnected' ? 'pill-disconnected' : isHost ? 'host-pill' : 'guest-pill')
              }
            >
              {roomStatusLabel}
            </p>
          </div>

          <div className="room-stack">
            <div className="room-card">
              <p className="room-card-label">Share code</p>
              <div className="room-readout">
                <span className="room-code room-code-display">{visibleRoomCode || 'No room created yet.'}</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={copyRoomCode}
                  disabled={!visibleRoomCode || roomState === 'disconnected'}
                >
                  Copy room code
                </button>
              </div>
            </div>

            <div className="room-card">
              <p className="room-card-label">Join with code</p>
              <div className="room-field">
                <label className="field-label" htmlFor="join-code">Room code to join</label>
                <input
                  id="join-code"
                  className="room-input"
                  value={joinCode}
                  onChange={function (event) { setJoinCode(event.target.value); }}
                  placeholder="Paste the code here"
                  spellCheck="false"
                />
              </div>

              <div className="room-actions">
                <button type="button" className="secondary" onClick={joinRoom}>Join room</button>
              </div>
            </div>
          </div>

          <div className="room-summary">
            <div>
              <p className="status-label">Active room</p>
              <p className="room-code">
                {roomState === 'disconnected' ? 'Room Disconnected' : visibleRoomCode || 'No room joined yet.'}
              </p>
              <p className="room-summary-copy">
                Socket.IO relays the signaling, and the browsers handle the media, chat, files, and screen share.
              </p>
            </div>
          </div>

          <div className="room-guide">
            <h3>How it works</h3>
            <ol>
              <li>Open the app in two browsers or devices.</li>
              <li>Grant camera and microphone access.</li>
              <li>The host clicks Create room and shares the code.</li>
              <li>The second user pastes the code and clicks Join room.</li>
              <li>Chat, file transfer, screen share, and media controls work inside the room.</li>
            </ol>
          </div>
        </div>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}
    </main>
  );
}

export default App;




