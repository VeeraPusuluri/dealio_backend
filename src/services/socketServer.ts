import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import prisma from '../utils/prisma';
import jwt from 'jsonwebtoken';
import { roleInThread, CANONICAL_THREAD_KEYS } from '../utils/thread';

const JWT_SECRET = process.env.JWT_SECRET || 'dealio-secret-key-12345';

// A chat thread is a private room within a deal: `deal:${dealId}:${threadKey}`.
// Only the two roles named in threadKey, and only if the caller is actually that
// party on the deal, may join or post. This keeps the customer↔builder and
// customer↔cp threads invisible to each other.
async function canAccessThread(
  dealId: number,
  userId: number,
  role: string | undefined,
  threadKey: string,
): Promise<boolean> {
  if (!role || !CANONICAL_THREAD_KEYS.has(threadKey) || !roleInThread(role, threadKey)) return false;
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { customerId: true, builder: { select: { userId: true } }, cp: { select: { userId: true } } },
  });
  if (!deal) return false;
  if (role === 'customer') return deal.customerId === userId;
  if (role === 'builder')  return deal.builder?.userId === userId;
  if (role === 'cp')       return deal.cp?.userId === userId;
  return false;
}

interface JoinPayload { dealId: number; threadKey: string }
interface SendPayload { dealId: number; threadKey: string; message: string }
const roomOf = (dealId: number, threadKey: string) => `deal:${dealId}:${threadKey}`;

interface AuthSocket extends Socket {
  userId?: number;
  userName?: string;
  userRole?: string;
}

let io: SocketServer;

export function initSocketServer(httpServer: HttpServer) {
  io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
        : '*',
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
  });

  io.use((socket: AuthSocket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Missing auth token'));
    try {
      // Auth tokens are signed with `id` (see authService/authController); accept
      // `userId` too for forward-compat. Reading the wrong field left socket.userId
      // undefined, which silently broke socket sends (the `!socket.userId` guard).
      const payload = jwt.verify(token, JWT_SECRET) as { id?: number; userId?: number; name?: string; fullName?: string; role: string };
      const uid = payload.id ?? payload.userId;
      if (uid === undefined) { next(new Error('Invalid token')); return; }
      socket.userId = uid;
      socket.userName = payload.name ?? payload.fullName ?? 'Unknown';
      socket.userRole = payload.role?.toLowerCase();
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthSocket) => {
    // Join a private deal thread and receive its message history.
    socket.on('join_deal', async (payload: JoinPayload) => {
      const dealId = Number(payload?.dealId);
      const threadKey = payload?.threadKey;
      if (!Number.isFinite(dealId) || !threadKey) return;
      if (!socket.userId || !(await canAccessThread(dealId, socket.userId, socket.userRole, threadKey))) {
        socket.emit('error', { message: 'Not authorized for this conversation' });
        return;
      }
      socket.join(roomOf(dealId, threadKey));
      try {
        const messages = await prisma.dealMessage.findMany({
          where: { dealId, threadKey },
          orderBy: { createdAt: 'asc' },
        });
        socket.emit('message_history', messages);
      } catch {
        socket.emit('error', { message: 'Failed to load messages' });
      }
    });

    socket.on('leave_deal', (payload: JoinPayload) => {
      if (payload?.dealId && payload?.threadKey) socket.leave(roomOf(Number(payload.dealId), payload.threadKey));
    });

    // Send a message: authorize the thread, persist with threadKey, broadcast to the thread room only.
    socket.on('send_message', async (data: SendPayload) => {
      const dealId = Number(data?.dealId);
      const threadKey = data?.threadKey;
      if (!socket.userId || !data?.message?.trim() || !Number.isFinite(dealId) || !threadKey) return;
      if (!(await canAccessThread(dealId, socket.userId, socket.userRole, threadKey))) {
        socket.emit('error', { message: 'Not authorized for this conversation' });
        return;
      }
      try {
        const saved = await prisma.dealMessage.create({
          data: {
            dealId,
            threadKey,
            senderId: socket.userId,
            senderName: socket.userName!,
            senderRole: socket.userRole!,
            message: data.message.trim(),
          },
        });
        io.to(roomOf(dealId, threadKey)).emit('deal_message', saved);
      } catch {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });
  });

  return io;
}

export function getSocketServer() {
  return io;
}