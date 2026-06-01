import { Router } from 'express';
import {
  createRoom,
  listRooms,
  getRoomDetails,
  listRoomMembers,
  addRoomMember,
  removeRoomMember,
} from '../controllers/room.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Apply authMiddleware to all room routes
router.use(authMiddleware as any);

router.post('/', createRoom as any);
router.get('/', listRooms as any);
router.get('/:roomId', getRoomDetails as any);
router.get('/:roomId/members', listRoomMembers as any);
router.post('/:roomId/members', addRoomMember as any);
router.delete('/:roomId/members/:userId', removeRoomMember as any);

export default router;
