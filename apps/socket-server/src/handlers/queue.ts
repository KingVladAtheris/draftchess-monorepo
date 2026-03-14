// apps/socket-server/src/handlers/queue.ts
import type { Socket } from 'socket.io'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@draftchess/socket-types'

type Sock = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>

export function registerQueueHandlers(socket: Sock): void {
  socket.on('join-queue',  () => {
    socket.join('queue')
    console.log(`[queue] user ${socket.data.userId} joined queue room`)
  })

  socket.on('leave-queue', () => {
    socket.leave('queue')
    console.log(`[queue] user ${socket.data.userId} left queue room`)
  })
}