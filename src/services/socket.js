import { io } from "socket.io-client";

let socketInstance = null;

// Create a single Socket.IO client for the lifetime of the app.
export function getAppSocket(socketUrl) {
  if (!socketInstance) {
    socketInstance = io(socketUrl, {
      transports: ["websocket"],
    });
  }

  return socketInstance;
}

// Tear down the shared socket when the app unmounts or exits a room.
export function destroyAppSocket() {
  if (!socketInstance) {
    return;
  }

  socketInstance.removeAllListeners();
  socketInstance.disconnect();
  socketInstance = null;
}
