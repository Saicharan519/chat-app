import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middlewares/auth.middleware';
import {
  uploadAndRegisterFile,
  deleteUploadedFile,
  getUploadSignature,
} from '../controllers/file.controller';

const router = Router();
const upload = multer();

// Apply auth middleware to all file-related routes
router.use(authMiddleware as any);

// Generate upload signature for ImageKit (IDOR protected)
router.post('/files/sign', getUploadSignature as any);

// Upload file directly to server and register it (IDOR protected)
router.post('/rooms/:roomId/files', upload.single('file'), uploadAndRegisterFile as any);

// Delete file message (removes from ImageKit and soft-deletes in DB)
// Using (*) wildcard to match public IDs containing slashes
router.delete('/files/:publicId(*)', deleteUploadedFile as any);

export default router;
