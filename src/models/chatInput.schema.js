const { z } = require('zod');
const { createHash } = require('crypto');
// Re-encoded JPEGs from the UI; server also validates signature and canonical base64.
const imageSchema = z.object({ mimeType: z.literal('image/jpeg'),
  data: z.string().min(8).max(700000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict()
  .refine(image => {
    const bytes = Buffer.from(image.data, 'base64');
    return bytes.length <= 512000 && bytes.toString('base64') === image.data
      && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  }, 'Use a JPEG image smaller than 500 KB');
const imagesSchema = z.array(imageSchema).max(1);
const imageHash = image => createHash('sha256').update(image.data).digest('hex');
module.exports = { imageSchema, imagesSchema, imageHash };
