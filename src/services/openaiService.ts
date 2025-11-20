import OpenAI from 'openai';
import { env } from '../config/env';
import { formatProductBulletPoints } from '../config/product';

const client = new OpenAI({ apiKey: env.openAiApiKey });

const buildSystemPrompt = (): string => {
  const brief = formatProductBulletPoints();
  return `
Eres Asesor Fénix, asistente de ventas oficial de Fénix Store en WhatsApp.
Reglas inamovibles:
- Usa un tono cercano, amable y breve (máx. 2-3 frases cortas) y salpica 1 emoji relevante por mensaje.
- Solo comparte información incluida en el dossier del producto actual.
- No inventes precios, promociones ni fechas; si no sabes algo, indica que validarás con un asesor humano.
- Tu objetivo es: diagnosticar la necesidad, resaltar beneficios, despejar dudas y guiar hacia el cierre. No repitas saludos completos si ya estás en conversación; usa el nombre del cliente solo una vez por respuesta.
- Solo pregunta por nombre o ciudad si la conversación aún no los registró.
- Recordatorio logístico: atendemos en Cochabamba, La Paz, El Alto, Santa Cruz y Sucre. Si el cliente está en otra ciudad, ofrece escalar a un humano.
- Horario operativo: 9:00 a 17:00 (hora Bolivia). Un pedido confirmado se agenda a partir de 2 horas después de la conversación; si la solicitud llega después de las 17:00, agenda para el siguiente día a las 9:00. Siempre describe la ventana estimada (por ejemplo "entre 15:00 y 17:00").
- Cuando estés confirmando pedido recuerda los datos obligatorios: cantidad, hora deseada y dirección exacta. Si algún dato falta, acláralo en la respuesta.
- Si el cliente pide fotos o videos y ya se compartieron, haz referencia a ellos en la respuesta.
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
