import { io, Socket } from 'socket.io-client';
import { env } from './env';

let socket: Socket | null = null;

export const getSocket = () => socket;

export const initSocket = (token: string): Socket => {
  if (socket) {
    socket.disconnect();
  }
  socket = io(env.VITE_SOCKET_URL, {
    auth: { token },
    autoConnect: false,
  });
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
