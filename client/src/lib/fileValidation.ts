/**
 * Reads the first N bytes of a file to check its magic number/file signature.
 * Helps prevent security bypasses like renaming malware.exe to photo.png.
 */
export async function validateMagicBytes(file: File): Promise<{
  isValid: boolean;
  error?: string;
}> {
  return new Promise((resolve) => {
    // If the file is empty, block it
    if (file.size === 0) {
      resolve({ isValid: false, error: 'File is empty.' });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = (e) => {
      if (!e.target || !e.target.result) {
        resolve({ isValid: false, error: 'Could not read file contents.' });
        return;
      }
      
      const arr = new Uint8Array(e.target.result as ArrayBuffer);
      let header = '';
      for (let i = 0; i < arr.length; i++) {
        header += arr[i].toString(16).padStart(2, '0').toLowerCase();
      }
      
      // 1. Check for blocked executables or scripts
      // - PE / Windows Executable: MZ (4d5a)
      // - ELF / Linux Executable: 7f454c46
      // - Java class file: cafebabe
      // - Mach-O / macOS: feedface / feedfacf / cafebabe
      // - Shell script / shebang: 2321 (ASCII: #!)
      if (header.startsWith('4d5a')) {
        resolve({ isValid: false, error: 'Executable files (.exe, .dll, etc.) are strictly blocked.' });
        return;
      }
      if (header.startsWith('7f454c46')) {
        resolve({ isValid: false, error: 'Linux ELF executables are blocked.' });
        return;
      }
      if (header.startsWith('cafebabe') || header.startsWith('feedface') || header.startsWith('feedfacf')) {
        resolve({ isValid: false, error: 'Binary executables are blocked.' });
        return;
      }
      if (header.startsWith('2321')) { // "#!"
        resolve({ isValid: false, error: 'Script files starting with shebang (#!) are blocked.' });
        return;
      }
      
      // 2. Validate format matching for common claimed types (e.g. images)
      const isClaimedImage = file.type.startsWith('image/');
      
      if (isClaimedImage) {
        // If file claims to be PNG, check png signature
        if (file.type === 'image/png' && !header.startsWith('89504e47')) {
          resolve({ isValid: false, error: 'Invalid PNG. Magic bytes do not match PNG signature.' });
          return;
        }
        // If file claims to be JPEG/JPG
        if ((file.type === 'image/jpeg' || file.type === 'image/jpg') && !header.startsWith('ffd8ff')) {
          resolve({ isValid: false, error: 'Invalid JPEG. Magic bytes do not match JPEG signature.' });
          return;
        }
        // If file claims to be GIF
        if (file.type === 'image/gif' && !header.startsWith('47494638')) {
          resolve({ isValid: false, error: 'Invalid GIF. Magic bytes do not match GIF signature.' });
          return;
        }
        // WebP (starts with RIFF '52494646')
        if (file.type === 'image/webp' && !header.startsWith('52494646')) {
          resolve({ isValid: false, error: 'Invalid WebP. Magic bytes do not match WebP/RIFF signature.' });
          return;
        }
      }
      
      resolve({ isValid: true });
    };
    
    // Read the first 8 bytes of the file
    reader.readAsArrayBuffer(file.slice(0, 8));
  });
}
