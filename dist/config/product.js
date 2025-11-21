"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatProductBulletPoints = exports.saveProductInfo = exports.getProductInfo = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const productCatalogService_1 = require("../services/productCatalogService");
const productFilePath = path_1.default.join(process.cwd(), 'data', 'product.json');
const parseProductFile = () => {
    try {
        const raw = fs_1.default.readFileSync(productFilePath, 'utf-8');
        return JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`No se pudo leer data/product.json: ${error.message}`);
    }
};
const getProductInfo = () => {
    const active = (0, productCatalogService_1.getActiveCatalogProduct)();
    if (active) {
        const { media, ...info } = active;
        return info;
    }
    return parseProductFile();
};
exports.getProductInfo = getProductInfo;
const saveProductInfo = async (info) => {
    await fs_1.default.promises.mkdir(path_1.default.dirname(productFilePath), { recursive: true });
    await fs_1.default.promises.writeFile(productFilePath, JSON.stringify(info, null, 2), 'utf-8');
};
exports.saveProductInfo = saveProductInfo;
const formatProductBulletPoints = (info = (0, exports.getProductInfo)()) => {
    const highlights = info.highlights.map((point) => `- ${point}`).join('\n');
    const materials = info.materials.map((material) => `- ${material}`).join('\n');
    return [
        `Nombre: ${info.name} (SKU: ${info.sku})`,
        `Precio sugerido: ${info.currency} ${info.price}`,
        `Descripción: ${info.shortDescription}`,
        `Beneficios clave:\n${highlights}`,
        `Materiales:\n${materials}`,
        `Contenido del paquete: ${info.packageIncludes}`,
        `Entrega: ${info.deliveryPromise}`,
        `Pitch comercial: ${info.pitch}`,
    ].join('\n\n');
};
exports.formatProductBulletPoints = formatProductBulletPoints;
