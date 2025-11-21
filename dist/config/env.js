"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
require("dotenv/config");
const required = (key) => {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
};
const normalizePort = (value) => {
    const parsed = Number(value ?? '3000');
    if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error('PORT must be a positive number');
    }
    return parsed;
};
const resolveSupabaseConfig = () => {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
        return null;
    }
    return { url, serviceRoleKey };
};
const resolveMediaBucket = () => {
    const value = process.env.PRODUCT_MEDIA_BUCKET;
    return value ?? null;
};
const resolveMediaPrefix = () => {
    const value = process.env.PRODUCT_MEDIA_PREFIX;
    if (!value) {
        return null;
    }
    const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
    return trimmed.length ? trimmed : null;
};
exports.env = {
    port: normalizePort(process.env.PORT),
    metaVerifyToken: process.env.META_VERIFY_TOKEN,
    metaAccessToken: process.env.META_ACCESS_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    openAiApiKey: process.env.OPENAI_API_KEY,
    operationsPhoneNumber: process.env.OPERATIONS_PHONE_NUMBER,
    supabase: resolveSupabaseConfig(),
    supabaseMediaBucket: resolveMediaBucket(),
    supabaseMediaPrefix: resolveMediaPrefix(),
};
