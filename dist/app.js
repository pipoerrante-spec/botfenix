"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectName = exports.buildTestNotes = exports.getTestChatSession = void 0;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const webhook_1 = __importDefault(require("./routes/webhook"));
const productConfig_1 = __importDefault(require("./routes/productConfig"));
const brandingConfig_1 = __importDefault(require("./routes/brandingConfig"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const openaiService_1 = require("./services/openaiService");
const conversationLogService_1 = require("./services/conversationLogService");
const app = (0, express_1.default)();
const staticDir = path_1.default.join(process.cwd(), 'public');
app.use(express_1.default.json());
app.use(express_1.default.static(staticDir));
app.use('/api/product', productConfig_1.default);
app.use('/api/branding', brandingConfig_1.default);
app.use('/api/dashboard', dashboard_1.default);
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});
app.post('/test-chat', async (req, res) => {
    const { message, sessionId: rawSessionId } = req.body ?? {};
    if (typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: "Falta 'message' en el body" });
    }
    const sessionId = typeof rawSessionId === 'string' && rawSessionId.trim().length ? rawSessionId.trim() : (0, crypto_1.randomUUID)();
    const session = getTestChatSession(sessionId);
    session.history.push({ role: 'user', content: message });
    if (!session.name) {
        session.name = detectName(message) ?? session.name;
    }
    await (0, conversationLogService_1.logConversationMessage)({
        conversationId: sessionId,
        channel: 'web',
        direction: 'incoming',
        message,
        name: session.name,
        metadata: { history_length: session.history.length },
    });
    try {
        const reply = await (0, openaiService_1.getChatGPTReply)(message, {
            name: session.name,
            phone: sessionId,
            stage: 'chatting',
            notes: buildTestNotes(session),
        });
        session.history.push({ role: 'assistant', content: reply });
        await (0, conversationLogService_1.logConversationMessage)({
            conversationId: sessionId,
            channel: 'web',
            direction: 'outgoing',
            message: reply,
            name: 'Asesor Fénix',
            metadata: { history_length: session.history.length },
        });
        return res.json({ reply, sessionId: session.id });
    }
    catch (error) {
        console.error('Error en /test-chat', error);
        return res.status(500).json({ error: 'Error interno' });
    }
});
app.use('/webhook', webhook_1.default);
app.use((err, _req, res, _next) => {
    console.error('Unhandled error', err);
    res.status(500).json({ message: 'Internal server error' });
});
exports.default = app;
const testChatSessions = new Map();
const getTestChatSession = (id) => {
    let session = testChatSessions.get(id);
    if (!session) {
        session = { id, history: [] };
        testChatSessions.set(id, session);
    }
    return session;
};
exports.getTestChatSession = getTestChatSession;
const buildTestNotes = (session) => {
    const historyNote = session.history
        .slice(-8)
        .map((entry) => `${entry.role === 'user' ? 'Cliente' : 'Asesor'}: ${entry.content}`)
        .join('\n');
    return [
        'Contexto: interacción en entorno web interno, simular conversación real.',
        `Historial reciente:\n${historyNote}`,
    ];
};
exports.buildTestNotes = buildTestNotes;
const detectName = (text) => {
    const match = text.match(/(?:soy|me llamo|mi nombre es)\s+([a-záéíóúüñ\s]+)/i);
    if (match?.[1]) {
        return match[1].trim().split(/\s+/).slice(0, 2).join(' ');
    }
    return undefined;
};
exports.detectName = detectName;
