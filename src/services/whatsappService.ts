import axios from 'axios';
import { env } from '../config/env';

const whatsappClient = axios.create({
  baseURL: `https://graph.facebook.com/v20.0/${env.phoneNumberId}`,
  headers: {
    Authorization: `Bearer ${env.metaAccessToken}`,
    'Content-Type': 'application/json',
  },
});

export const sendTextMessage = async (to: string, text: string): Promise<void> => {
  try {
    await whatsappClient.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {
        body: text,
      },
    });
  } catch (error) {
    console.error('Error sending WhatsApp message', error);
    throw error;
  }
};

interface MediaPayload {
  to: string;
  type: 'image' | 'video';
  link: string;
  caption?: string;
}

export const sendMediaMessage = async ({ to, type, link, caption }: MediaPayload): Promise<void> => {
  try {
    await whatsappClient.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type,
      [type]: {
        link,
        caption,
      },
    });
  } catch (error) {
    console.error('Error sending WhatsApp media', error);
    throw error;
  }
};
