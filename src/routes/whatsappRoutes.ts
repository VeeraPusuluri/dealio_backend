import { Router, raw } from 'express';
import { whatsappWebhook } from '../controllers/whatsappController';

const router = Router();

// GET handshake (no body). POST events use a raw parser so the controller can
// verify the X-Hub-Signature-256 HMAC against the exact bytes Meta sent.
router.get('/webhook', whatsappWebhook.verify);
router.post('/webhook', raw({ type: '*/*' }), whatsappWebhook.receive);

export default router;
