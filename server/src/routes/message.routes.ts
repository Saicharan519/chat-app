import { Router } from 'express';
import {
  getRoomMessages,
  createMessage,
  editMessage,
  deleteMessage,
  semanticSearch,
} from '../controllers/message.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Apply authMiddleware to all message routes
router.use(authMiddleware as any);

router.get('/room/:roomId', getRoomMessages as any);
router.get('/room/:roomId/semantic-search', semanticSearch as any);
router.post('/room/:roomId', createMessage as any);
router.patch('/:messageId', editMessage as any);
router.delete('/:messageId', deleteMessage as any);

export default router;

