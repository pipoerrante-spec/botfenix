import { Router, Request, Response } from 'express';
import { BrandingConfig, BrandingTheme, getBrandingConfig, saveBrandingConfig } from '../config/branding';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  try {
    const branding = getBrandingConfig();
    return res.json(branding);
  } catch (error) {
    console.error('Error leyendo branding', error);
    return res.status(500).json({ error: 'No se pudo cargar la configuración de branding' });
  }
});

router.put('/', async (req: Request, res: Response) => {
  try {
    const payload = normalizeBrandingPayload(req.body ?? {});
    await saveBrandingConfig(payload);
    return res.json({ message: 'Branding actualizado', branding: payload });
  } catch (error) {
    console.error('Error guardando branding', error);
    return res.status(400).json({ error: (error as Error).message });
  }
});

const normalizeBrandingPayload = (raw: Record<string, unknown>): BrandingConfig => {
  return {
    botName: requireString(raw.botName, 'botName'),
    statusLine: requireString(raw.statusLine, 'statusLine'),
    carrierLabel: requireString(raw.carrierLabel, 'carrierLabel'),
    greeting: requireString(raw.greeting, 'greeting'),
    placeholder: requireString(raw.placeholder, 'placeholder'),
    avatarInitials: requireString(raw.avatarInitials ?? '', 'avatarInitials'),
    theme: normalizeTheme(raw.theme),
  };
};

const normalizeTheme = (value: unknown): BrandingTheme => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('theme es obligatorio');
  }
  const theme = value as Record<string, unknown>;
  const fields: Array<keyof BrandingTheme> = [
    'background',
    'panel',
    'primary',
    'secondary',
    'accent',
    'text',
    'textMuted',
    'border',
  ];
  const normalized: Partial<BrandingTheme> = {};
  for (const field of fields) {
    normalized[field] = requireColor(theme[field], `theme.${field}`);
  }
  return normalized as BrandingTheme;
};

const requireColor = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`El campo ${field} es obligatorio`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`El campo ${field} no puede estar vacío`);
  }
  return normalized;
};

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`El campo ${field} es obligatorio`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`El campo ${field} no puede estar vacío`);
  }
  return normalized;
};

export default router;
