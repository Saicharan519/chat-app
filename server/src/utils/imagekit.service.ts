import imagekit from '../config/imagekit';
import { env } from '../config/env';

export interface ImageKitAuthResponse {
  token: string;
  expire: number;
  signature: string;
  publicKey: string;
  urlEndpoint: string;
}

export class ImageKitService {
  /**
   * Generates server-side auth parameters for secure client-side direct upload.
   * The private key never leaves the server.
   * Returns a fresh token — must be used once only per upload.
   */
  static getAuthParams(): ImageKitAuthResponse {
    const authParams = imagekit.helper.getAuthenticationParameters();
    return {
      ...authParams,        // { token, expire, signature }
      publicKey: env.IMAGEKIT_PUBLIC_KEY,
      urlEndpoint: env.IMAGEKIT_URL_ENDPOINT,
    };
  }

  /**
   * Deletes a file from ImageKit permanently using its fileId.
   */
  static async deleteFile(fileId: string): Promise<void> {
    await imagekit.files.delete(fileId);
  }

  /**
   * Uploads a file buffer to ImageKit.
   */
  static async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    folder?: string
  ): Promise<{ url: string; fileId: string }> {
    const result = await imagekit.files.upload({
      file: fileBuffer.toString('base64'),
      fileName: fileName,
      folder: folder,
    });
    if (!result.url || !result.fileId) {
      throw new Error('Failed to upload file to ImageKit: URL or FileID missing in response');
    }
    return {
      url: result.url,
      fileId: result.fileId,
    };
  }
}

