import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { aiRateLimiter } from '../middlewares/rate-limiter.middleware';
import {
  getSmartReplies,
  refineMessageTone,
  refineMessageCustom,
  streamChatSummary,
  streamAssistant,
} from '../controllers/ai.controller';

const router = Router();

// All AI routes require authentication + rate limiting
router.use(authMiddleware as any);
router.use(aiRateLimiter as any);

router.post('/smart-reply', getSmartReplies as any);
router.post('/tone', refineMessageTone as any);
router.post('/editor', refineMessageCustom as any);
router.post('/summarize', streamChatSummary as any);
router.post('/assistant', streamAssistant as any);

export default router;
