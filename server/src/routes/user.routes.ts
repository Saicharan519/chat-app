import { Router } from 'express';
import { getMe, searchUsers } from '../controllers/user.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Apply authMiddleware to all user routes
router.use(authMiddleware as any);

router.get('/me', getMe as any);
router.get('/search', searchUsers as any);

export default router;
