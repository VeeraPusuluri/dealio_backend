import { Router } from 'express';
import { aiController } from '../controllers/aiController';

const router = Router();

// GET /api/ai/health — verify Claude connectivity
router.get('/health', aiController.health);

// POST /api/ai/chat — SSE streaming chat
router.post('/chat', aiController.chat);

export default router;
