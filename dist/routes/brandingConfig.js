"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const branding_1 = require("../config/branding");
const router = (0, express_1.Router)();
router.get('/', (_req, res) => {
    try {
        const branding = (0, branding_1.getBrandingConfig)();
        return res.json(branding);
    }
    catch (error) {
        console.error('Error leyendo branding', error);
        return res.status(500).json({ error: 'No se pudo cargar la configuración de branding' });
    }
});
router.put('/', async (req, res) => {
    try {
        const payload = normalizeBrandingPayload(req.body ?? {});
        await (0, branding_1.saveBrandingConfig)(payload);
        return res.json({ message: 'Branding actualizado', branding: payload });
    }
    catch (error) {
        console.error('Error guardando branding', error);
        return res.status(400).json({ error: error.message });
    }
});
const normalizeBrandingPayload = (raw) => {
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
const normalizeTheme = (value) => {
    if (typeof value !== 'object' || value === null) {
        throw new Error('theme es obligatorio');
    }
    const theme = value;
    const fields = [
        'background',
        'panel',
        'primary',
        'secondary',
        'accent',
        'text',
        'textMuted',
        'border',
    ];
    const normalized = {};
    for (const field of fields) {
        normalized[field] = requireColor(theme[field], `theme.${field}`);
    }
    return normalized;
};
const requireColor = (value, field) => {
    if (typeof value !== 'string') {
        throw new Error(`El campo ${field} es obligatorio`);
    }
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`El campo ${field} no puede estar vacío`);
    }
    return normalized;
};
const requireString = (value, field) => {
    if (typeof value !== 'string') {
        throw new Error(`El campo ${field} es obligatorio`);
    }
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`El campo ${field} no puede estar vacío`);
    }
    return normalized;
};
exports.default = router;
