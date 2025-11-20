import { Router, Request, Response } from 'express';
import { DateTime } from 'luxon';
import { env } from '../config/env';
import { sendTextMessage, sendMediaMessage } from '../services/whatsappService';
import { getChatGPTReply } from '../services/openaiService';
import { getProductInfo } from '../config/product';
import { getBrandingConfig } from '../config/branding';
import { logConversationMessage } from '../services/conversationLogService';
import { listProductMedia, MediaAsset } from '../services/mediaService';
import { WhatsAppWebhookRequestBody, WhatsAppTextMessage, WhatsAppContact } from '../types/whatsapp';
import { ensureLeadSession, saveLeadSession, findLeadSession } from '../services/leadSessionStore';
import { LeadSession, LeadStage, OrderDraft, OrderField } from '../types/leadSession';

const router = Router();

const LA_PAZ_ZONE = 'America/La_Paz';
const DELIVERY_START_HOUR = 9;
const DELIVERY_CUTOFF_HOUR = 17;
const PREPARATION_HOURS = 2;
const DELIVERY_WINDOW_HOURS = 2;
const SUPPORTED_CITIES = ['cochabamba', 'la paz', 'el alto', 'santa cruz', 'sucre'];
const MEDIA_KEYWORDS = ['foto', 'imagen', 'video', 'demo', 'mostrar', 'ver', 'clip'];

const ORDER_FIELD_LABELS: Record<OrderField, string> = {
  quantity: 'la cantidad exacta que desea',
  deliveryTime: 'una ventana de 2 horas (ej. entre 10:00 y 12:00) para la entrega',
  address: 'un enlace de ubicación (no en tiempo real) o dirección exacta para la entrega',
};

const ORDER_KEYWORDS = ['comprar', 'pedido', 'orden', 'agendar', 'apartalo', 'lo quiero', 'mandalo', 'envíalo', 'envialo'];
const POSITIVE_CONFIRMATIONS = ['si', 'sí', 'claro', 'confirmo', 'ok', 'va', 'dale', 'perfecto', 'queda'];
const NEGATIVE_KEYWORDS = ['cambiar', 'cancel', 'cancelar', 'modificar'];

const operationsPhoneNormalized = normalizePhone(env.operationsPhoneNumber);

const getWelcomeMessage = (): string => {
  try {
    const branding = getBrandingConfig();
    return branding.greeting || 'Hola, soy Asesor Fénix. ¿En qué te puedo ayudar hoy?';
  } catch (error) {
    return 'Hola, soy Asesor Fénix. ¿En qué te puedo ayudar hoy?';
  }
};

interface IncomingMessagePayload {
  waId: string;
  normalizedWaId: string;
  profileName?: string;
  text: string;
}

export const handleIncomingMessage = async ({
  waId,
  normalizedWaId,
  profileName,
  text,
}: IncomingMessagePayload): Promise<void> => {
  const cleanText = text.trim();
  if (!cleanText) {
    return;
  }

  const laPazNow = getLaPazNow();

  const session = await ensureLeadSession({ waId, normalizedWaId, profileName });
  session.history.push(`Cliente (${new Date().toISOString()}): ${cleanText}`);

  await logConversationMessage({
    conversationId: normalizedWaId,
    channel: 'whatsapp',
    direction: 'incoming',
    message: cleanText,
    phone: session.waId,
    name: session.name ?? profileName,
    metadata: { stage: session.stage },
  });

  if (session.name && !session.nameConfirmed) {
    session.nameConfirmed = isLikelyPersonalName(session.name);
  }

  try {
    if (session.stage === 'nuevo') {
      if (session.nameConfirmed) {
        session.stage = 'chatting';
        await sendProductIntro(session, normalizedWaId, { includeWelcome: true, personalize: true });
      } else {
        session.stage = 'awaiting_name';
        const welcome = '¡Hola! Soy Asesor Fénix 👋 ¿Con quién tengo el gusto?';
        await sendTextMessage(session.waId, welcome);
        recordBotMessage(session, welcome);
        await logConversationMessage({
          conversationId: normalizedWaId,
          channel: 'whatsapp',
          direction: 'outgoing',
          message: welcome,
          phone: session.waId,
          name: 'Asesor Fénix',
          metadata: { stage: session.stage },
        });
      }
      return;
    }

    if (session.stage === 'awaiting_name' && !session.nameConfirmed) {
      const explicitName = extractNameFromMessage(cleanText);
      if (explicitName) {
        session.name = explicitName;
        session.nameConfirmed = isLikelyPersonalName(explicitName);
        if (session.nameConfirmed) {
          session.stage = 'chatting';
          await sendProductIntro(session, normalizedWaId, { personalize: true });
          return;
        }
        const clarify = 'Gracias. ¿Me compartes el nombre de la persona que coordina (no el de la empresa)?';
        await sendTextMessage(session.waId, clarify);
        recordBotMessage(session, clarify);
        await logConversationMessage({
          conversationId: normalizedWaId,
          channel: 'whatsapp',
          direction: 'outgoing',
          message: clarify,
          phone: session.waId,
          name: 'Asesor Fénix',
          metadata: { stage: session.stage },
        });
        return;
      } else {
        const reminder = 'Solo necesito tu nombre para personalizar la atención 😊';
        await sendTextMessage(session.waId, reminder);
        recordBotMessage(session, reminder);
        await logConversationMessage({
          conversationId: normalizedWaId,
          channel: 'whatsapp',
          direction: 'outgoing',
          message: reminder,
          phone: session.waId,
          name: 'Asesor Fénix',
          metadata: { stage: session.stage },
        });
        return;
      }
    }

    if (!session.nameConfirmed) {
      session.stage = 'awaiting_name';
      const prompt = 'Para ayudarte mejor necesito tu nombre real 😊';
      await sendTextMessage(session.waId, prompt);
      recordBotMessage(session, prompt);
      await logConversationMessage({
        conversationId: normalizedWaId,
        channel: 'whatsapp',
        direction: 'outgoing',
        message: prompt,
        phone: session.waId,
        name: 'Asesor Fénix',
        metadata: { stage: session.stage },
      });
      return;
    }

    if (!session.city) {
      const city = extractCityFromMessage(cleanText);
      if (city) {
        session.city = city;
        session.cityAllowed = isCitySupported(city);
      }
    }

    updateSessionInsights(session, cleanText);

    await maybeHandleCoverageNotice(session, normalizedWaId);

    if (!session.introducedProduct) {
      await sendProductIntro(session, normalizedWaId, { personalize: session.nameConfirmed });
    }

    const askedForMedia = shouldShareMedia(cleanText) || isProductInterest(cleanText);
    const resendRequested = session.mediaShared && needsMediaResend(cleanText);
    const wantsMedia = askedForMedia && (!session.mediaShared || resendRequested || session.stage === 'awaiting_confirmation');
    if (wantsMedia) {
      await shareProductMedia({
        session,
        normalizedWaId,
        isResend: resendRequested,
      });
    }

    if (session.stage === 'chatting' && session.cityAllowed !== false && shouldStartOrderFlow(cleanText)) {
      startOrderFlow(session);
    }

    if (session.stage === 'collecting_order') {
      const captureResult = captureOrderField(session, cleanText);
      if (captureResult === 'awaiting_confirmation') {
        await sendOrderSummary(session, laPazNow);
        return;
      }
    }

    if (session.stage === 'awaiting_confirmation') {
      if (isPositiveConfirmation(cleanText)) {
        await confirmOrderWithOperations(session);
        return;
      }

      if (wantsToModifyOrder(cleanText)) {
        session.stage = 'collecting_order';
        session.pendingFields = determineMissingFields(session.order);
      }
    }

    let pendingField: string | undefined;
    if (!session.nameConfirmed) {
      pendingField = 'tu nombre para personalizar la atención';
    } else if (session.cityAllowed === false) {
      pendingField = `una ciudad dentro de nuestra cobertura (${formatCoverageList()})`;
    } else if ((session.stage === 'collecting_order' || session.stage === 'awaiting_confirmation') && !session.city) {
      pendingField = 'el enlace de ubicación (sin compartir ubicación en vivo) o la ciudad exacta para coordinar la entrega';
    } else if (session.pendingFields[0]) {
      pendingField = ORDER_FIELD_LABELS[session.pendingFields[0]];
    }

    const contextParts = [
      `Etapa: ${session.stage}`,
      `Nombre cliente: ${session.nameConfirmed ? session.name : 'desconocido'}`,
      `Ciudad cliente: ${session.city ?? 'sin definir'}`,
      `Hora local (Bolivia): ${laPazNow.setLocale('es').toFormat('EEEE dd HH:mm')}`,
    ];
    if (session.cityAllowed === false) {
      contextParts.push(`El cliente está fuera de cobertura (permitidas: ${formatCoverageList()})`);
    }
    if (session.interests?.length) {
      contextParts.push(`Intereses mencionados: ${session.interests.join(', ')}`);
    }
    if (session.order) {
      contextParts.push(
        `Pedido: ${session.order.quantity ?? '?'} x ${session.order.productName} (${session.order.currency} ${session.order.price}) - estado ${session.order.status}`,
      );
    }

    const historySnippet = session.history.slice(-8).join('\n');
    const aiInput = `${contextParts.join('\n')}\n\nHistorial reciente:\n${historySnippet}\n\nNuevo mensaje del cliente: ${cleanText}`;

    try {
      const aiReply = await getChatGPTReply(aiInput, {
        name: session.nameConfirmed ? session.name : undefined,
        city: session.city,
        phone: session.waId,
        stage: session.stage,
        pendingField,
        notes: buildContextNotes(session),
      });

      await sendTextMessage(session.waId, aiReply);
      recordBotMessage(session, aiReply);
      await logConversationMessage({
        conversationId: normalizedWaId,
        channel: 'whatsapp',
        direction: 'outgoing',
        message: aiReply,
        phone: session.waId,
        name: 'Asesor Fénix',
        metadata: { stage: session.stage },
      });

    } catch (error) {
      console.error('Error al procesar la respuesta de OpenAI', error);
    }
  } finally {
    await saveLeadSession(session);
  }
};

router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.metaVerifyToken && typeof challenge === 'string') {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as WhatsAppWebhookRequestBody;

  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages ?? [];
        for (const message of messages) {
          if (!isTextMessage(message)) {
            continue;
          }

          const from = message.from;
          const normalizedFrom = normalizePhone(from);
          const text = message.text?.body ?? '';

          if (!text.trim()) {
            continue;
          }

          if (normalizedFrom === operationsPhoneNormalized) {
            await logConversationMessage({
              conversationId: normalizedFrom,
              channel: 'operations',
              direction: 'incoming',
              message: text,
              phone: from,
            });
            try {
              await handleOperationsControlMessage(text);
            } catch (error) {
              console.error('Error manejando comando de operaciones', error);
            }
            continue;
          }

          const name = extractContactName(change.value?.contacts, from);

          try {
            await handleIncomingMessage({ waId: from, normalizedWaId: normalizedFrom, profileName: name, text });
          } catch (error) {
            console.error('Error dispatching incoming WhatsApp event', error);
          }
        }
      }
    }
  }

  return res.status(200).json({ status: 'received' });
});

const handleOperationsControlMessage = async (rawText: string): Promise<void> => {
  const [command, phone, ...rest] = rawText.split('|').map((part) => part.trim());
  if (!command) {
    await notifyOperationsChannel('Formato inválido. Usa AGENDA_OK|telefono|hora o PEDIDO_ENTREGADO|telefono|nota');
    return;
  }

  const normalizedTarget = phone ? normalizePhone(phone) : '';
  const session = normalizedTarget ? await findLeadSession(normalizedTarget) : undefined;

  if (!session || !session.order) {
    await notifyOperationsChannel(`No encontré al cliente ${phone ?? ''}.`);
    return;
  }

  try {
    switch (command.toUpperCase()) {
      case 'AGENDA_OK': {
        const slot = rest[0] || session.order.requestedTime || 'sin hora definida';
        session.order.status = 'scheduled';
        session.order.confirmedSlot = slot;
        session.stage = 'scheduled';
        const message = `¡Listo ${session.name ?? ''}! Tu pedido quedó agendado para ${slot}. Te avisaré cuando salga a ruta.`;
        await sendTextMessage(session.waId, message);
        recordBotMessage(session, message);
        await logConversationMessage({
          conversationId: session.normalizedWaId,
          channel: 'whatsapp',
          direction: 'outgoing',
          message,
          phone: session.waId,
          name: 'Asesor Fénix',
          metadata: { stage: session.stage },
        });
        await notifyOperationsChannel(`Cliente ${session.name ?? session.waId} notificado de agenda ${slot}.`, {
          customer: session.waId,
          slot,
        });
        break;
      }
      case 'PEDIDO_ENTREGADO': {
        session.order.status = 'delivered';
        session.stage = 'delivered';
        const deliveredMessage = `Hola ${session.name ?? ''}, nuestro equipo confirma que tu pedido fue entregado. ¿Todo llegó bien?`;
        await sendTextMessage(session.waId, deliveredMessage);
        recordBotMessage(session, deliveredMessage);
        await logConversationMessage({
          conversationId: session.normalizedWaId,
          channel: 'whatsapp',
          direction: 'outgoing',
          message: `Hola ${session.name ?? ''}, nuestro equipo confirma que tu pedido fue entregado. ¿Todo llegó bien?`,
          phone: session.waId,
          name: 'Asesor Fénix',
          metadata: { stage: session.stage },
        });
        await notifyOperationsChannel('Seguimiento de entrega enviado al cliente.', {
          customer: session.waId,
        });
        break;
      }
      default:
        await notifyOperationsChannel('Comando no reconocido. Usa AGENDA_OK o PEDIDO_ENTREGADO.');
        break;
    }
  } finally {
    await saveLeadSession(session);
  }
};

const shouldShareMedia = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return MEDIA_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

const isProductInterest = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return normalized.includes('producto') || normalized.includes('información') || normalized.includes('info');
};

const isCitySupported = (city?: string): boolean => {
  if (!city) {
    return false;
  }
  return SUPPORTED_CITIES.includes(city.toLowerCase());
};

const formatCoverageList = (): string => SUPPORTED_CITIES.map((city) => capitalizeWords(city)).join(', ');

const getLaPazNow = (): DateTime => DateTime.now().setZone(LA_PAZ_ZONE);

const calculateDeliverySlot = (reference?: DateTime): { start: DateTime; end: DateTime; label: string } => {
  const base = (reference ?? getLaPazNow()).setZone(LA_PAZ_ZONE);
  const earliestStartToday = base.set({ hour: DELIVERY_START_HOUR, minute: 0, second: 0, millisecond: 0 });
  const cutoffToday = base.set({ hour: DELIVERY_CUTOFF_HOUR, minute: 0, second: 0, millisecond: 0 });

  let start = base.plus({ hours: PREPARATION_HOURS });
  if (start < earliestStartToday) {
    start = earliestStartToday;
  }
  if (start > cutoffToday) {
    start = earliestStartToday.plus({ days: 1 });
  }

  const end = start.plus({ hours: DELIVERY_WINDOW_HOURS });
  const dayLabel = start.hasSame(base, 'day')
    ? 'hoy'
    : start.hasSame(base.plus({ days: 1 }), 'day')
      ? 'mañana'
      : start.setLocale('es').toFormat('cccc dd');

  const label = `entre ${start.setLocale('es').toFormat('HH:mm')} y ${end
    .setLocale('es')
    .toFormat('HH:mm')} ${dayLabel}`;

  return { start, end, label };
};

const recordBotMessage = (session: LeadSession, text: string): void => {
  session.history.push(`Bot (${new Date().toISOString()}): ${text}`);
};

const extractNameFromMessage = (message: string): string | undefined => {
  const explicit = message.match(
    /(?:soy|me llamo|mi nombre(?:s)? es|me llaman|me dicen|mi apodo es)\s*[:\-]?\s*([a-záéíóúüñ\s]+)/i,
  );
  if (explicit?.[1]) {
    return capitalizeWords(explicit[1].trim());
  }

  if (/^[a-záéíóúüñ]{2,}$/i.test(message.trim())) {
    return capitalizeWords(message.trim());
  }

  return undefined;
};

const extractCityFromMessage = (message: string): string | undefined => {
  const match = message.match(/(?:de|desde|en)\s+([a-záéíóúüñ\s]+)/i);
  if (match?.[1]) {
    return capitalizeWords(match[1].trim());
  }
  return undefined;
};

const updateSessionInsights = (session: LeadSession, message: string): void => {
  const lower = message.toLowerCase();
  const cityMatch = message.match(/(?:soy de|estoy en|en la ciudad de|ciudad\s*)([a-záéíóúüñ\s]+)/i);
  if (cityMatch && !session.city) {
    session.city = capitalizeWords(cityMatch[1].trim());
    session.cityAllowed = isCitySupported(session.city);
  }

  const interestKeywords = ['tenis', 'zapatos', 'running', 'bolsa', 'gym', 'atleta'];
  const newInterests = interestKeywords.filter((keyword) => lower.includes(keyword));
  if (newInterests.length) {
    session.interests = Array.from(new Set([...(session.interests ?? []), ...newInterests]));
  }
};

const shouldStartOrderFlow = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return ORDER_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

const startOrderFlow = (session: LeadSession): void => {
  session.stage = 'collecting_order';
  session.pendingFields = ['quantity', 'deliveryTime', 'address'];
  const product = getProductInfo();
  session.order = {
    productName: product.name,
    price: product.price,
    currency: product.currency,
    status: 'collecting',
  };
};

type CaptureResult = 'captured' | 'awaiting_confirmation' | 'pending';

const captureOrderField = (session: LeadSession, message: string): CaptureResult => {
  if (!session.order) {
    startOrderFlow(session);
  }

  const pendingField = session.pendingFields[0];
  if (!pendingField || !session.order) {
    return 'pending';
  }

  const normalizedMessage = message.toLowerCase();

  switch (pendingField) {
    case 'quantity': {
      const quantity = detectQuantity(normalizedMessage);
      if (quantity) {
        session.order.quantity = quantity;
        session.pendingFields.shift();
      }
      break;
    }
    case 'deliveryTime': {
      const deliveryWindow = extractDeliveryWindow(message);
      if (deliveryWindow) {
        session.order.requestedTime = deliveryWindow;
        session.pendingFields.shift();
      }
      break;
    }
    case 'address': {
      if (message.length > 5) {
        session.order.address = message.trim();
        session.pendingFields.shift();
      }
      break;
    }
    default:
      break;
  }

  if (!session.pendingFields.length && hasCompleteOrder(session.order)) {
    return 'awaiting_confirmation';
  }

  return 'captured';
};

const hasCompleteOrder = (order: OrderDraft): boolean => {
  return Boolean(order.quantity && order.requestedTime && order.address);
};

const determineMissingFields = (order?: OrderDraft): OrderField[] => {
  if (!order) {
    return ['quantity', 'deliveryTime', 'address'];
  }

  const fields: OrderField[] = [];
  if (!order.quantity) {
    fields.push('quantity');
  }
  if (!order.requestedTime) {
    fields.push('deliveryTime');
  }
  if (!order.address) {
    fields.push('address');
  }
  return fields;
};

const sendOrderSummary = async (session: LeadSession, laPazNow: DateTime): Promise<void> => {
  if (!session.order) {
    return;
  }

  const quantity = session.order.quantity ?? 1;
  const total = quantity * session.order.price;
  const slot = calculateDeliverySlot(laPazNow);
  session.order.confirmedSlot = slot.label;
  const summary = `Perfecto ${session.name ?? ''}! Tengo tu pedido: ${quantity} x ${session.order.productName} (${session.order.currency} ${session.order.price} c/u, total ${session.order.currency} ${total}). Podemos entregar ${slot.label}. Dirección registrada: ${session.order.address ?? 'por confirmar'}. ¿Confirmamos para agendarlo?`;

  session.stage = 'awaiting_confirmation';
  await sendTextMessage(session.waId, summary);
  recordBotMessage(session, summary);
  await logConversationMessage({
    conversationId: session.normalizedWaId,
    channel: 'whatsapp',
    direction: 'outgoing',
    message: summary,
    phone: session.waId,
    name: 'Asesor Fénix',
    metadata: { stage: session.stage },
  });
};

const confirmOrderWithOperations = async (session: LeadSession): Promise<void> => {
  if (!session.order) {
    return;
  }

  session.order.status = 'pending_ops';
  session.stage = 'pending_ops';

  const slotLabel = session.order.confirmedSlot ?? calculateDeliverySlot().label;
  const ackMessage = `Gracias ${session.name ?? ''}. Estoy avisando al equipo para agendar tu pedido ${slotLabel}. En cuanto me confirmen la hora exacta, te escribo.`;
  await sendTextMessage(session.waId, ackMessage);
  recordBotMessage(session, ackMessage);
  await logConversationMessage({
    conversationId: session.normalizedWaId,
    channel: 'whatsapp',
    direction: 'outgoing',
    message: ackMessage,
    phone: session.waId,
    name: 'Asesor Fénix',
    metadata: { stage: session.stage },
  });

  const opsMessage = buildOperationsMessage(session);
  await notifyOperationsChannel(opsMessage, { customer: session.waId });
};

const buildOperationsMessage = (session: LeadSession): string => {
  const order = session.order!;
  return [
    '🟠 Nuevo pedido Asesor Fénix',
    `Cliente: ${session.name ?? 'Sin nombre'} (${session.waId})`,
    `Ciudad: ${session.city ?? 'N/D'}`,
    `Producto: ${order.quantity ?? '1'} x ${order.productName}`,
    `Precio unitario: ${order.currency} ${order.price}`,
    `Ventana estimada: ${order.confirmedSlot ?? order.requestedTime ?? 'Por confirmar'}`,
    `Dirección: ${order.address ?? 'Pendiente'}`,
    '',
    `Responder con:`,
    `AGENDA_OK|${session.waId}|<hora confirmada>`,
    `PEDIDO_ENTREGADO|${session.waId}|<nota opcional>`,
  ].join('\n');
};

const buildContextNotes = (session: LeadSession): string[] => {
  const notes: string[] = [];
  if (session.interests?.length) {
    notes.push(`Intereses detectados: ${session.interests.join(', ')}`);
  }
  if (session.order) {
    const order = session.order;
    notes.push(
      `Pedido -> ${order.quantity ?? '?'} x ${order.productName} (${order.currency} ${order.price}) | Estado: ${order.status} | Hora solicitada: ${order.requestedTime ?? 'pendiente'}`,
    );
    if (order.confirmedSlot) {
      notes.push(`Ventana confirmada: ${order.confirmedSlot}`);
    }
    if (order.address) {
      notes.push(`Dirección confirmada: ${order.address}`);
    }
  }
  notes.push(`Media compartida: ${session.mediaShared ? 'sí' : 'no'}`);
  return notes;
};

const sendProductIntro = async (
  session: LeadSession,
  normalizedWaId: string,
  options?: { includeWelcome?: boolean; personalize?: boolean },
): Promise<void> => {
  if (session.introducedProduct) {
    return;
  }

  const includeWelcome = options?.includeWelcome ?? false;
  const personalize = options?.personalize ?? false;

  const product = getProductInfo();
  const greeting = includeWelcome ? 'Hola, soy Asesor Fénix 👋' : undefined;
  const nameHook = personalize && session.name ? `Gracias, ${session.name}.` : undefined;
  const highlightSource = (product.highlights[0] ?? product.shortDescription).trim();
  const sanitizedHighlight = highlightSource.replace(/\s*\(.*?\)/g, '').replace(/\s{2,}/g, ' ').trim();
  const highlightBase = sanitizedHighlight.length ? sanitizedHighlight : product.shortDescription;
  const normalizedHighlight = highlightBase
    ? highlightBase.charAt(0).toLowerCase() + highlightBase.slice(1)
    : 'son ideales para personalizar tu vehículo';
  const baseLine = `Tengo los ${product.name} en ${product.currency} ${product.price}: ${normalizedHighlight}.`;
  const question = '¿Te mando fotos y video o prefieres hablar de instalación y tiempos?';
  const introMessage = [greeting, nameHook, baseLine, question].filter(Boolean).join(' ');

  await sendTextMessage(session.waId, introMessage);
  recordBotMessage(session, introMessage);
  await logConversationMessage({
    conversationId: normalizedWaId,
    channel: 'whatsapp',
    direction: 'outgoing',
    message: introMessage,
    phone: session.waId,
    name: 'Asesor Fénix',
    metadata: { stage: session.stage, intro: true },
  });

  session.introducedProduct = true;
  if (!session.mediaShared) {
    await shareProductMedia({
      session,
      normalizedWaId,
      introMessage: 'Te dejo fotos y un video para que veas cómo lucen en el parabrisas 👇',
    });
  }
};

const maybeHandleCoverageNotice = async (session: LeadSession, normalizedWaId: string): Promise<void> => {
  if (session.city && session.cityAllowed === false && !session.cityNoticeSent) {
    const coverageList = formatCoverageList();
    const notice = `Por ahora realizamos entregas en ${coverageList}. ¿Puedes compartir una dirección o punto de entrega dentro de esas ciudades?`;
    await sendTextMessage(session.waId, notice);
    recordBotMessage(session, notice);
    await logConversationMessage({
      conversationId: normalizedWaId,
      channel: 'whatsapp',
      direction: 'outgoing',
      message: notice,
      phone: session.waId,
      name: 'Asesor Fénix',
      metadata: { stage: session.stage, coverage: true },
    });
    session.cityNoticeSent = true;
  }
};

const shareProductMedia = async ({
  session,
  normalizedWaId,
  isResend,
  introMessage,
}: {
  session: LeadSession;
  normalizedWaId: string;
  isResend?: boolean;
  introMessage?: string;
}): Promise<void> => {
  const assets = await listProductMedia();
  if (!assets.length) {
    const fallback =
      'Aún no tengo archivos listos para compartir en este momento, pero ya pedí al equipo que los habilite y te aviso apenas estén disponibles.';
    await sendTextMessage(session.waId, fallback);
    recordBotMessage(session, fallback);
    await logConversationMessage({
      conversationId: normalizedWaId,
      channel: 'whatsapp',
      direction: 'outgoing',
      message: fallback,
      phone: session.waId,
      name: 'Asesor Fénix',
      metadata: { stage: session.stage, mediaShared: false },
    });
    return;
  }

  const intro = introMessage
    ? introMessage
    : isResend
      ? 'Reenviando las fotos del producto para que las tengas a mano 👇'
      : 'Te comparto fotos y videos del producto para que lo veas mejor 👇';
  await sendTextMessage(session.waId, intro);
  recordBotMessage(session, intro);
  await logConversationMessage({
    conversationId: normalizedWaId,
    channel: 'whatsapp',
    direction: 'outgoing',
    message: intro,
    phone: session.waId,
    name: 'Asesor Fénix',
    metadata: { stage: session.stage, mediaShared: true, mediaResend: Boolean(isResend) },
  });

  let sentAny = false;
  for (const asset of assets) {
    if (asset.type === 'video' && !canSendVideoAsset(asset)) {
      const linkMessage = `${asset.caption ?? 'Video demostrativo'}: ${asset.url}`;
      await sendTextMessage(session.waId, linkMessage);
      recordBotMessage(session, linkMessage);
      sentAny = true;
      await logConversationMessage({
        conversationId: normalizedWaId,
        channel: 'whatsapp',
        direction: 'outgoing',
        message: linkMessage,
        phone: session.waId,
        name: 'Asesor Fénix',
        metadata: { stage: session.stage, mediaShared: true, fallbackLink: true },
      });
      continue;
    }

    try {
      await sendMediaMessage({ to: session.waId, type: asset.type, link: asset.url, caption: asset.caption });
      sentAny = true;
      const mediaLog = `[Media ${asset.type}] ${asset.caption ?? asset.url}`;
      recordBotMessage(session, mediaLog);
      await logConversationMessage({
        conversationId: normalizedWaId,
        channel: 'whatsapp',
        direction: 'outgoing',
        message: mediaLog,
        phone: session.waId,
        name: 'Asesor Fénix',
        metadata: { stage: session.stage, mediaShared: true },
      });
    } catch (error) {
      console.error('No se pudo enviar media, enviando fallback con link', error);
      const fallbackText = `Aquí tienes el enlace: ${asset.url}`;
      await sendTextMessage(session.waId, fallbackText);
      recordBotMessage(session, fallbackText);
      sentAny = true;
      await logConversationMessage({
        conversationId: normalizedWaId,
        channel: 'whatsapp',
        direction: 'outgoing',
        message: fallbackText,
        phone: session.waId,
        name: 'Asesor Fénix',
        metadata: { stage: session.stage, mediaShared: true, fallbackLink: true },
      });
    }
  }

  if (!sentAny) {
    const notice = 'Hubo un problema enviando archivos, te dejo los links aquí:';
    await sendTextMessage(session.waId, `${notice}\n${assets.map((asset) => asset.url).join('\n')}`);
  }

  session.mediaShared = true;
};

function needsMediaResend(message: string): boolean {
  const normalized = message.toLowerCase();
  const resendClues = ['reenv', 'otra vez', 'no me lleg', 'no llegaron', 'no llegó', 'no recib'];
  return resendClues.some((pattern) => normalized.includes(pattern));
}

const SUPPORTED_VIDEO_EXTENSIONS = ['mp4', '3gp', '3gpp'];

const BUSINESS_NAME_KEYWORDS = [
  'srl',
  's.a',
  'sa',
  'sac',
  'corp',
  'company',
  'compañía',
  'compania',
  'co',
  'team',
  'group',
  'store',
  'shop',
  'tienda',
  'digital',
  'studio',
  'club',
  'club',
  'motors',
  'motor',
  'autos',
  'logistics',
  'logística',
  'logistica',
  'solutions',
  'soluciones',
  'agency',
  'agencia',
  'marketing',
  'import',
  'export',
  'distrib',
  'ignite',
  'factory',
  'servicios',
  'service',
  'systems',
  'ventures',
];

const isLikelyPersonalName = (value: string): boolean => {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  if (/\d/.test(normalized)) {
    return false;
  }

  const lower = normalized.toLowerCase();
  if (BUSINESS_NAME_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3) {
    return false;
  }

  if (!words.every((word) => /^[a-záéíóúüñ]+$/i.test(word))) {
    return false;
  }

  const uppercaseWords = words.filter((word) => word.length > 2 && word === word.toUpperCase());
  if (uppercaseWords.length === words.length) {
    return false;
  }

  return true;
};

const canSendVideoAsset = (asset: MediaAsset): boolean => {
  if (asset.type !== 'video') {
    return true;
  }

  if (!asset.extension) {
    return true;
  }

  return SUPPORTED_VIDEO_EXTENSIONS.includes(asset.extension.toLowerCase());
};

const notifyOperationsChannel = async (message: string, metadata?: Record<string, unknown>): Promise<void> => {
  await sendTextMessage(env.operationsPhoneNumber, message);
  await logConversationMessage({
    conversationId: operationsPhoneNormalized,
    channel: 'operations',
    direction: 'outgoing',
    message,
    phone: env.operationsPhoneNumber,
    name: 'Asesor Fénix',
    metadata,
  });
};

const detectQuantity = (message: string): number | undefined => {
  const match = message.match(/(\d+)/);
  if (match) {
    const quantity = parseInt(match[1], 10);
    if (quantity > 0) {
      return quantity;
    }
  }
  if (message.includes('un') || message.includes('una')) {
    return 1;
  }
  return undefined;
};

const extractDeliveryWindow = (message: string): string | undefined => {
  const timeMatch = message.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const suffix = timeMatch[3]?.toLowerCase();
    if (suffix === 'pm' && hour < 12) {
      hour += 12;
    }
    if (suffix === 'am' && hour === 12) {
      hour = 0;
    }

    let start = getLaPazNow().set({ hour, minute, second: 0, millisecond: 0 });
    if (start < getLaPazNow().plus({ minutes: 30 })) {
      start = start.plus({ days: 1 });
    }
    const end = start.plus({ hours: DELIVERY_WINDOW_HOURS });
    return `entre ${start.setLocale('es').toFormat('HH:mm')} y ${end.setLocale('es').toFormat('HH:mm')}`;
  }

  const dayMatch = message.match(/hoy|mañana|tarde|noche|fin de semana/i);
  if (dayMatch) {
    return capitalizeWords(dayMatch[0]);
  }

  if (message.length <= 60) {
    return message.trim();
  }

  return undefined;
};

const isPositiveConfirmation = (message: string): boolean => {
  const tokens = message
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-záéíóúüñ]/gi, ''));
  return tokens.some((token) => POSITIVE_CONFIRMATIONS.includes(token));
};

const wantsToModifyOrder = (message: string): boolean => {
  const tokens = message
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-záéíóúüñ]/gi, ''));
  return tokens.some((token) => NEGATIVE_KEYWORDS.includes(token));
};

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

const capitalizeWords = (text: string): string => {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const extractContactName = (contacts: WhatsAppContact[] | undefined, waId: string): string | undefined => {
  return contacts?.find((contact) => contact.wa_id === waId)?.profile?.name ?? contacts?.[0]?.profile?.name;
};

const isTextMessage = (message: WhatsAppTextMessage): boolean => {
  return message.type === 'text' && typeof message.text?.body === 'string';
};

export default router;
