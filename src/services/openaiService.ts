import OpenAI from 'openai';
import { env } from '../config/env';
import { formatProductBulletPoints } from '../config/product';

const client = new OpenAI({ apiKey: env.openAiApiKey });

const buildSystemPrompt = (): string => {
  const brief = formatProductBulletPoints();
  return `
Eres Asesor Fénix, asistente de ventas oficial de Fénix Store en WhatsApp.
Reglas inamovibles:
- Usa un tono cercano, amable y breve (máx. 2-3 frases cortas).
- Solo comparte información incluida en el dossier del producto actual.
- No inventes precios, promociones ni fechas; si no sabes algo, indica que validarás con un asesor humano.
- Tu objetivo es: 1) saludar y pedir nombre, 2) diagnosticar necesidad, 3) resaltar producto y precio, 4) agendar pedido o derivar a humano.
- Mantén siempre el personaje de “Asesor Fénix”.
- Cuando estés confirmando pedido recuerda los datos obligatorios: cantidad, hora deseada, dirección exacta.
- Si ya se agendó o entregó, haz seguimiento breve para confirmar satisfacción.

Dossier del producto disponible (manténlo intacto y úsalo como única fuente):
${brief}
`;
};

type ChatContext = {
  name?: string;
  phone?: string;
  city?: string;
  stage?: string;
  pendingField?: string;
  notes?: string[];
};

export const getChatGPTReply = async (
  userMessage: string,
  context?: ChatContext,
): Promise<string> => {
  const contextLines: string[] = [];

  if (context?.name) {
    contextLines.push(`Nombre del cliente: ${context.name}`);
  }

  if (context?.city) {
    contextLines.push(`Ciudad: ${context.city}`);
  }

  if (context?.phone) {
    contextLines.push(`Teléfono: ${context.phone}`);
  }

  if (context?.stage) {
    contextLines.push(`Etapa actual: ${context.stage}`);
  }

  if (context?.pendingField) {
    contextLines.push(`Dato que debes solicitar: ${context.pendingField}`);
  }

  if (context?.notes?.length) {
    contextLines.push(`Notas adicionales:\n${context.notes.join('\n')}`);
  }

  const enrichedMessage = contextLines.length
    ? `${contextLines.join('\n')}\n\n${userMessage}`
    : userMessage;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: enrichedMessage },
    ],
  });

  const aiMessage = response.choices[0]?.message?.content?.trim();

  if (!aiMessage) {
    return 'Por ahora no puedo responder, pero un asesor humano te contactará pronto.';
  }

  return aiMessage;
};
