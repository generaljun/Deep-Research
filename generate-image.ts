import { GoogleGenAI } from "@google/genai";
import fs from 'fs';
import path from 'path';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateImage() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          {
            text: 'A simple, clean, and beautiful anime-style (2D) illustration of a smart AI assistant character (maybe a cute robot or a smart anime girl with glasses) working on research reports. The image must contain the text "江军的深度报告生成AI助手" prominently and clearly. Pastel colors, soft lighting, very high quality, masterpiece.',
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "1K"
        }
      },
    });
    
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const base64EncodeString = part.inlineData.data;
        const buffer = Buffer.from(base64EncodeString, 'base64');
        const dir = path.join(process.cwd(), 'public');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'hero.png'), buffer);
        console.log('Image generated successfully at public/hero.png');
        return;
      }
    }
    console.log('No image data found in response.');
  } catch (e) {
    console.error('Error generating image:', e);
  }
}

generateImage();
