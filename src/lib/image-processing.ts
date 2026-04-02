
/**
 * Enhances an image for better OCR results.
 * Adjusts contrast, brightness, and applies sharpening using a canvas.
 */
export async function enhanceImageForOCR(base64: string, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64);
        return;
      }

      // Increase resolution for better OCR if needed
      const scale = 1.5;
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      // Draw original image with scaling
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Apply image enhancement filters
      // Grayscale + high contrast + slight brightness boost
      ctx.filter = 'grayscale(100%) contrast(1.5) brightness(1.1)';
      ctx.drawImage(canvas, 0, 0);
      
      // Optional: Basic sharpening could be done here with a convolution matrix
      // but ctx.filter is usually enough for Gemini's vision.
      
      resolve(canvas.toDataURL(mimeType, 0.95).split(',')[1]);
    };
    img.onerror = reject;
    img.src = `data:${mimeType};base64,${base64}`;
  });
}
