// apps/socket-server/src/auth.ts
import { getToken } from 'next-auth/jwt'
import type { Socket, ExtendedError } from 'socket.io'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@draftchess/socket-types'

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>

export async function authMiddleware(
  socket: TypedSocket,
  next: (err?: ExtendedError) => void,
): Promise<void> {
  try {
    const req   = { headers: socket.handshake.headers } as any
    const token = await getToken({ req, secret: process.env.AUTH_SECRET })
    if (!token?.id) return next(new Error('Unauthorized') as ExtendedError)
    socket.data.userId = parseInt(token.id as string, 10)
    next()
  } catch {
    next(new Error('Unauthorized') as ExtendedError)
  }
}