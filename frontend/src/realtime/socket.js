import { io } from 'socket.io-client';

// In production (Vercel), WebSocket must connect directly to Railway
// because Vercel rewrites don't support WebSocket upgrades.
// Set VITE_SOCKET_URL=https://soac-api-production.up.railway.app in Vercel env vars.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

let socket;

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL || '/', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
  }
  return socket;
}
