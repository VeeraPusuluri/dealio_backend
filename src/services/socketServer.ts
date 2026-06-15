import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import prisma from '../utils/prisma';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dealio-secret-key-12345';

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
      const payload = jwt.verify(token, JWT_SECRET) as { userId: number; name?: string; fullName?: string; role: string };
      socket.userId = payload.userId;
      socket.userName = payload.name ?? payload.fullName ?? 'Unknown';
      socket.userRole = payload.role?.toLowerCase();
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthSocket) => {
    // Join a deal room and receive message history
    socket.on('join_deal', async (dealId: number) => {
      const room = `deal:${dealId}`;
      socket.join(room);
      try {
        const messages = await prisma.dealMessage.findMany({
          where: { dealId },
          orderBy: { createdAt: 'asc' },
        });
        socket.emit('message_history', messages);
      } catch {
        socket.emit('error', { message: 'Failed to load messages' });
      }
    });

    socket.on('leave_deal', (dealId: number) => {
      socket.leave(`deal:${dealId}`);
    });

    // Send a message: save to DB + broadcast to room
    socket.on('send_message', async (data: { dealId: number; message: string }) => {
      if (!socket.userId || !data.message?.trim()) return;
      try {
        const saved = await prisma.dealMessage.create({
          data: {
            dealId: data.dealId,
            senderId: socket.userId,
            senderName: socket.userName!,
            senderRole: socket.userRole!,
            message: data.message.trim(),
          },
        });
        io.to(`deal:${data.dealId}`).emit('deal_message', saved);
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