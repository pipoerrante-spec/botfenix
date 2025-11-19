"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleIncomingMessage = void 0;
const express_1 = require("express");
const env_1 = require("../config/env");
const whatsappService_1 = require("../services/whatsappService");
const openaiService_1 = require("../services/openaiService");
const product_1 = require("../config/product");
const conversationLogService_1 = require("../services/conversationLogService");
const router = (0, express_1.Router)();
const leadSessions = new Map();
const ORDER_FIELD_LABELS = {
    quantity: 'la cantidad exacta que desea',
    deliveryTime: 'la hora o fecha que prefiere para recibirlo',
    address: 'la dirección o ubicación precisa de entrega',
};
const ORDER_KEYWORDS = ['comprar', 'pedido', 'orden', 'agendar', 'apartalo', 'lo quiero', 'mandalo', 'envíalo', 'envialo'];
const POSITIVE_CONFIRMATIONS = ['si', 'sí', 'claro', 'confirmo', 'ok', 'va', 'dale', 'perfecto', 'queda'];
const NEGATIVE_KEYWORDS = ['cambiar', 'cancel', 'cancelar', 'modificar'];
const operationsPhoneNormalized = normalizePhone(env_1.env.operationsPhoneNumber);
const WELCOME_MESSAGE = 'Hola, soy Asesor Fénix de Fénix Store. Estoy listo para ayudarte con tu compra. ¿Cómo te llamas?';
const buildCityPrompt = (name) => {
    const product = (0, product_1.getProductInfo)();
    return `Gracias${name ? ` ${name}` : ''}. ¿En qué ciudad te encuentras para coordinar entrega del ${product.name}?`;
};
const handleIncomingMessage = async ({ waId, normalizedWaId, profileName, text, }) => {
    const cleanText = text.trim();
    if (!cleanText) {
        return;
    }
    const session = ensureSession(waId, normalizedWaId, profileName);
    session.history.push(`Cliente (${new Date().toISOString()}): ${cleanText}`);
    await (0, conversationLogService_1.logConversationMessage)({
        conversationId: normalizedWaId,
        channel: 'whatsapp',
        direction: 'incoming',
        message: cleanText,
        phone: session.waId,
        name: session.name ?? profileName,
        metadata: { stage: session.stage },
    });
    if (session.stage === 'nuevo') {
        await (0, whatsappService_1.sendTextMessage)(session.waId, WELCOME_MESSAGE);
        session.stage = 'awaiting_name';
        await (0, conversationLogService_1.logConversationMessage)({
            conversationId: normalizedWaId,
            channel: 'whatsapp',
            direction: 'outgoing',
            message: WELCOME_MESSAGE,
            phone: session.waId,
            name: 'Asesor Fénix',
            metadata: { stage: session.stage },
        });
        return;
    }
    if (session.stage === 'awaiting_name') {
        session.name = extractNameFromMessage(cleanText) ?? session.name ?? profileName;
        if (!session.name) {
            await (0, whatsappService_1.sendTextMessage)(session.waId, '¿Me compartes tu nombre para personalizar tu atención?');
            await (0, conversationLogService_1.logConversationMessage)({
                conversationId: normalizedWaId,
                channel: 'whatsapp',
                direction: 'outgoing',
                message: '¿Me compartes tu nombre para personalizar tu atención?',
                phone: session.waId,
                name: 'Asesor Fénix',
                metadata: { stage: session.stage },
            });
            return;
        }
        session.stage = 'awaiting_city';
        const prompt = buildCityPrompt(session.name.split(' ')[0]);
        await (0, whatsappService_1.sendTextMessage)(session.waId, prompt);
        await (0, conversationLogService_1.logConversationMessage)({
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
    if (session.stage === 'awaiting_city') {
        session.city = extractCityFromMessage(cleanText) ?? cleanText;
        session.stage = 'chatting';
    }
    updateSessionInsights(session, cleanText);
    if (session.stage === 'chatting' && shouldStartOrderFlow(cleanText)) {
        startOrderFlow(session);
    }
    if (session.stage === 'collecting_order') {
        const captureResult = captureOrderField(session, cleanText);
        if (captureResult === 'awaiting_confirmation') {
            await sendOrderSummary(session);
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
    const pendingField = session.pendingFields[0] ? ORDER_FIELD_LABELS[session.pendingFields[0]] : undefined;
    try {
        const aiReply = await (0, openaiService_1.getChatGPTReply)(cleanText, {
            name: session.name,
            city: session.city,
            phone: session.waId,
            stage: session.stage,
            pendingField,
            notes: buildContextNotes(session),
        });
        await (0, whatsappService_1.sendTextMessage)(session.waId, aiReply);
        await (0, conversationLogService_1.logConversationMessage)({
            conversationId: normalizedWaId,
            channel: 'whatsapp',
            direction: 'outgoing',
            message: aiReply,
            phone: session.waId,
            name: 'Asesor Fénix',
            metadata: { stage: session.stage },
        });
    }
    catch (error) {
        console.error('Error al procesar la respuesta de OpenAI', error);
    }
};
exports.handleIncomingMessage = handleIncomingMessage;
router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === env_1.env.metaVerifyToken && typeof challenge === 'string') {
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});
router.post('/', async (req, res) => {
    const body = req.body;
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
                        await (0, conversationLogService_1.logConversationMessage)({
                            conversationId: normalizedFrom,
                            channel: 'operations',
                            direction: 'incoming',
                            message: text,
                            phone: from,
                        });
                        try {
                            await handleOperationsControlMessage(text);
                        }
                        catch (error) {
                            console.error('Error manejando comando de operaciones', error);
                        }
                        continue;
                    }
                    const name = extractContactName(change.value?.contacts, from);
                    try {
                        await (0, exports.handleIncomingMessage)({ waId: from, normalizedWaId: normalizedFrom, profileName: name, text });
                    }
                    catch (error) {
                        console.error('Error dispatching incoming WhatsApp event', error);
                    }
                }
            }
        }
    }
    return res.status(200).json({ status: 'received' });
});
const handleOperationsControlMessage = async (rawText) => {
    const [command, phone, ...rest] = rawText.split('|').map((part) => part.trim());
    if (!command) {
        await notifyOperationsChannel('Formato inválido. Usa AGENDA_OK|telefono|hora o PEDIDO_ENTREGADO|telefono|nota');
        return;
    }
    const normalizedTarget = phone ? normalizePhone(phone) : '';
    const session = normalizedTarget ? leadSessions.get(normalizedTarget) : undefined;
    if (!session || !session.order) {
        await notifyOperationsChannel(`No encontré al cliente ${phone ?? ''}.`);
        return;
    }
    switch (command.toUpperCase()) {
        case 'AGENDA_OK': {
            const slot = rest[0] || session.order.requestedTime || 'sin hora definida';
            session.order.status = 'scheduled';
            session.order.confirmedSlot = slot;
            session.stage = 'scheduled';
            const message = `¡Listo ${session.name ?? ''}! Tu pedido quedó agendado para ${slot}. Te avisaré cuando salga a ruta.`;
            await (0, whatsappService_1.sendTextMessage)(session.waId, message);
            await (0, conversationLogService_1.logConversationMessage)({
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
            await (0, whatsappService_1.sendTextMessage)(session.waId, `Hola ${session.name ?? ''}, nuestro equipo confirma que tu pedido fue entregado. ¿Todo llegó bien?`);
            await (0, conversationLogService_1.logConversationMessage)({
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
};
const ensureSession = (waId, normalizedWaId, profileName) => {
    let session = leadSessions.get(normalizedWaId);
    if (!session) {
        session = {
            waId,
            normalizedWaId,
            stage: 'nuevo',
            history: [],
            pendingFields: [],
        };
        leadSessions.set(normalizedWaId, session);
    }
    session.waId = waId;
    if (profileName && !session.name) {
        session.name = profileName;
    }
    return session;
};
const extractNameFromMessage = (message) => {
    const explicit = message.match(/(?:soy|me llamo|mi nombre es)\s+([a-záéíóúüñ\s]+)/i);
    if (explicit?.[1]) {
        return capitalizeWords(explicit[1].trim());
    }
    const clean = message.replace(/[^a-záéíóúüñ\s]/gi, ' ').trim();
    if (!clean) {
        return undefined;
    }
    const words = clean.split(/\s+/).slice(0, 2).join(' ');
    return capitalizeWords(words);
};
const extractCityFromMessage = (message) => {
    const match = message.match(/(?:de|desde|en)\s+([a-záéíóúüñ\s]+)/i);
    if (match?.[1]) {
        return capitalizeWords(match[1].trim());
    }
    if (message.length <= 40) {
        return capitalizeWords(message.trim());
    }
    return undefined;
};
const updateSessionInsights = (session, message) => {
    const lower = message.toLowerCase();
    const cityMatch = message.match(/(?:soy de|estoy en|en la ciudad de|ciudad\s*)([a-záéíóúüñ\s]+)/i);
    if (cityMatch && !session.city) {
        session.city = capitalizeWords(cityMatch[1].trim());
    }
    const interestKeywords = ['tenis', 'zapatos', 'running', 'bolsa', 'gym', 'atleta'];
    const newInterests = interestKeywords.filter((keyword) => lower.includes(keyword));
    if (newInterests.length) {
        session.interests = Array.from(new Set([...(session.interests ?? []), ...newInterests]));
    }
};
const shouldStartOrderFlow = (message) => {
    const normalized = message.toLowerCase();
    return ORDER_KEYWORDS.some((keyword) => normalized.includes(keyword));
};
const startOrderFlow = (session) => {
    session.stage = 'collecting_order';
    session.pendingFields = ['quantity', 'deliveryTime', 'address'];
    const product = (0, product_1.getProductInfo)();
    session.order = {
        productName: product.name,
        price: product.price,
        currency: product.currency,
        status: 'collecting',
    };
};
const captureOrderField = (session, message) => {
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
const hasCompleteOrder = (order) => {
    return Boolean(order.quantity && order.requestedTime && order.address);
};
const determineMissingFields = (order) => {
    if (!order) {
        return ['quantity', 'deliveryTime', 'address'];
    }
    const fields = [];
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
const sendOrderSummary = async (session) => {
    if (!session.order) {
        return;
    }
    const quantity = session.order.quantity ?? 1;
    const total = quantity * session.order.price;
    const summary = `Perfecto ${session.name ?? ''}. Tengo tu pedido: ${quantity} x ${session.order.productName} (${session.order.currency} ${session.order.price} c/u, total ${session.order.currency} ${total}). Entrega solicitada: ${session.order.requestedTime ?? 'horario pendiente'}. Dirección: ${session.order.address ?? 'por confirmar'}. ¿Confirmamos para agendarlo?`;
    session.stage = 'awaiting_confirmation';
    await (0, whatsappService_1.sendTextMessage)(session.waId, summary);
    await (0, conversationLogService_1.logConversationMessage)({
        conversationId: session.normalizedWaId,
        channel: 'whatsapp',
        direction: 'outgoing',
        message: summary,
        phone: session.waId,
        name: 'Asesor Fénix',
        metadata: { stage: session.stage },
    });
};
const confirmOrderWithOperations = async (session) => {
    if (!session.order) {
        return;
    }
    session.order.status = 'pending_ops';
    session.stage = 'pending_ops';
    const ackMessage = `Gracias ${session.name ?? ''}. Estoy avisando al equipo para agendar tu pedido. En cuanto me confirmen la hora, te escribo.`;
    await (0, whatsappService_1.sendTextMessage)(session.waId, ackMessage);
    await (0, conversationLogService_1.logConversationMessage)({
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
const buildOperationsMessage = (session) => {
    const order = session.order;
    return [
        '🟠 Nuevo pedido Asesor Fénix',
        `Cliente: ${session.name ?? 'Sin nombre'} (${session.waId})`,
        `Ciudad: ${session.city ?? 'N/D'}`,
        `Producto: ${order.quantity ?? '1'} x ${order.productName}`,
        `Precio unitario: ${order.currency} ${order.price}`,
        `Entrega solicitada: ${order.requestedTime ?? 'Por confirmar'}`,
        `Dirección: ${order.address ?? 'Pendiente'}`,
        '',
        `Responder con:`,
        `AGENDA_OK|${session.waId}|<hora confirmada>`,
        `PEDIDO_ENTREGADO|${session.waId}|<nota opcional>`,
    ].join('\n');
};
const buildContextNotes = (session) => {
    const notes = [];
    if (session.interests?.length) {
        notes.push(`Intereses detectados: ${session.interests.join(', ')}`);
    }
    if (session.order) {
        const order = session.order;
        notes.push(`Pedido -> ${order.quantity ?? '?'} x ${order.productName} (${order.currency} ${order.price}) | Estado: ${order.status} | Hora solicitada: ${order.requestedTime ?? 'pendiente'}`);
        if (order.address) {
            notes.push(`Dirección confirmada: ${order.address}`);
        }
        if (order.confirmedSlot) {
            notes.push(`Horario confirmado por operaciones: ${order.confirmedSlot}`);
        }
    }
    return notes;
};
const notifyOperationsChannel = async (message, metadata) => {
    await (0, whatsappService_1.sendTextMessage)(env_1.env.operationsPhoneNumber, message);
    await (0, conversationLogService_1.logConversationMessage)({
        conversationId: operationsPhoneNormalized,
        channel: 'operations',
        direction: 'outgoing',
        message,
        phone: env_1.env.operationsPhoneNumber,
        name: 'Asesor Fénix',
        metadata,
    });
};
const detectQuantity = (message) => {
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
const extractDeliveryWindow = (message) => {
    const timeMatch = message.match(/(\d{1,2}(?::\d{2})?\s?(?:am|pm)?)/i);
    if (timeMatch) {
        return timeMatch[0];
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
const isPositiveConfirmation = (message) => {
    const tokens = message
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.replace(/[^a-záéíóúüñ]/gi, ''));
    return tokens.some((token) => POSITIVE_CONFIRMATIONS.includes(token));
};
const wantsToModifyOrder = (message) => {
    const tokens = message
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.replace(/[^a-záéíóúüñ]/gi, ''));
    return tokens.some((token) => NEGATIVE_KEYWORDS.includes(token));
};
function normalizePhone(phone) {
    return phone.replace(/\D/g, '');
}
const capitalizeWords = (text) => {
    return text
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};
const extractContactName = (contacts, waId) => {
    return contacts?.find((contact) => contact.wa_id === waId)?.profile?.name ?? contacts?.[0]?.profile?.name;
};
const isTextMessage = (message) => {
    return message.type === 'text' && typeof message.text?.body === 'string';
};
exports.default = router;
