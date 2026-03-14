// apps/web/src/app/lib/socket.ts
'use client';

import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
let connectPromise: Promise<Socket> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3001'

export const getSocket = (): Promise<Socket> => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('getSocket can only be called on the client'));
  }

  if (socket?.connected) {
    return Promise.resolve(socket);
  }

  if (connectPromise) {
    return connectPromise;
  }

  if (!socket) {
    socket = io(SOCKET_URL, {
      path:                '/socket.io',
      withCredentials:     true,
      reconnection:        true,
      reconnectionAttempts: 5,
      reconnectionDelay:   1000,
      transports:          ['websocket', 'polling'],
      autoConnect:         false,
    });

    socket.on('connect', () => {
      // Start heartbeat — refreshes online:userId key in Redis every 60s
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (socket?.connected) socket.emit('heartbeat');
      }, 60_000);
    });

    socket.on('disconnect', (reason: string) => {
      console.log(`Socket disconnected: ${reason}`);
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (!socket?.connected) {
        connectPromise = null;
      }
    });

    socket.on('connect_error', (err: Error) => {
      console.error('Socket connection error:', err.message);
    });
  }

  connectPromise = new Promise<Socket>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Socket connection timeout (5s)'));
    }, 5000);

    const onConnect = () => {
      cleanup();
      console.log('Socket connected successfully → ID:', socket!.id);
      resolve(socket!);
    };

    // FIX #26: connectPromise is nulled BEFORE reject() is called.
    // Previously, connectPromise was nulled inside cleanup() which ran
    // after reject() — meaning any caller that had already awaited this
    // promise and caught the error would see connectPromise still set
    // to the rejected promise on their next getSocket() call, and
    // receive another rejection instead of a fresh attempt.
    const onError = (err: Error) => {
      connectPromise = null; // clear first so future callers get a fresh attempt
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket?.off('connect', onConnect);
      socket?.off('connect_error', onError);
      // Note: connectPromise is NOT nulled here — onError does it explicitly
      // before calling cleanup, and onConnect leaves it set until the next
      // disconnect so in-flight callers resolve correctly.
    };

    socket!.once('connect', onConnect);
    socket!.once('connect_error', onError);

    if (!socket!.active) {
      socket!.connect();
    }
  });

  return connectPromise;
};