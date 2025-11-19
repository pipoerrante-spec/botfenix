"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTextMessage = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
const whatsappClient = axios_1.default.create({
    baseURL: `https://graph.facebook.com/v20.0/${env_1.env.phoneNumberId}`,
    headers: {
        Authorization: `Bearer ${env_1.env.metaAccessToken}`,
        'Content-Type': 'application/json',
    },
});
const sendTextMessage = async (to, text) => {
    try {
        await whatsappClient.post('/messages', {
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: {
                body: text,
            },
        });
    }
    catch (error) {
        console.error('Error sending WhatsApp message', error);
        throw error;
    }
};
exports.sendTextMessage = sendTextMessage;
