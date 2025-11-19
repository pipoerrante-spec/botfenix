import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { env } from './config/env';
import webhookRouter from './routes/webhook';
import productConfigRouter from './routes/productConfig';
import { getChatGPTReply } from './services/openaiService';
import { logConversationMessage } from './services/conversationLogService';

const app = express();
const staticDir = path.join(__dirname, '../public');

app.use(express.json());
app.use(express.static(staticDir));
app.use('/api/product', productConfigRouter);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.post('/test-chat', async (req: Request, res: Response) => {
  const { message, sessionId: rawSessionId } = req.body ?? {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: "Falta 'message' en el body" });
  }

  const sessionId = typeof rawSessionId === 'string' && rawSessionId.trim().length ? rawSessionId.trim() : randomUUID();
  const session = getTestChatSession(sessionId);
  session.history.push({ role: 'user', content: message });
  if (!session.name) {
    session.name = detectName(message) ?? session.name;
  }

  await logConversationMessage({
    conversationId: sessionId,
    channel: 'web',
    direction: 'incoming',
    message,
    name: session.name,
    metadata: { history_length: session.history.length },
  });

  try {
    const reply = await getChatGPTReply(message, {
      name: session.name,
      phone: sessionId,
      stage: 'chatting',
      notes: buildTestNotes(session),
    });

    session.history.push({ role: 'assistant', content: reply });

    await logConversationMessage({
      conversationId: sessionId,
      channel: 'web',
      direction: 'outgoing',
      message: reply,
      name: 'Asesor Fénix',
      metadata: { history_length: session.history.length },
    });
    return res.json({ reply, sessionId: session.id });
  } catch (error) {
    console.error('Error en /test-chat', error);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.use('/webhook', webhookRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error', err);
  res.status(500).json({ message: 'Internal server error' });
});

app.listen(env.port, () => {
  console.log(`Asesor Fénix server ready on port ${env.port}`);
});

export default app;

// curl -X POST http://localhost:3000/test-chat -H "Content-Type: application/json" -d '{"message":"Hola"}'

type TestChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

interface TestChatSession {
  id: string;
  history: TestChatMessage[];
  name?: string;
}

const testChatSessions = new Map<string, TestChatSession>();

const getTestChatSession = (id: string): TestChatSession => {
  let session = testChatSessions.get(id);
  if (!session) {
    session = { id, history: [] };
    testChatSessions.set(id, session);
  }
  return session;
};

const buildTestNotes = (session: TestChatSession): string[] => {
  const historyNote = session.history
    .slice(-8)
    .map((entry) => `${entry.role === 'user' ? 'Cliente' : 'Asesor'}: ${entry.content}`)
    .join('\n');

  return [
    'Contexto: interacción en entorno web interno, simular conversación real.',
    `Historial reciente:\n${historyNote}`,
  ];
};

const detectName = (text: string): string | undefined => {
  const match = text.match(/(?:soy|me llamo|mi nombre es)\s+([a-záéíóúüñ\s]+)/i);
  if (match?.[1]) {
    return match[1].trim().split(/\s+/).slice(0, 2).join(' ');
  }
  return undefined;
};
