"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveBrandingConfig = exports.getBrandingConfig = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const brandingFilePath = path_1.default.join(process.cwd(), 'data', 'branding.json');
const parseBrandingFile = () => {
    try {
        const raw = fs_1.default.readFileSync(brandingFilePath, 'utf-8');
        return JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`No se pudo leer data/branding.json: ${error.message}`);
    }
};
const getBrandingConfig = () => {
    return parseBrandingFile();
};
exports.getBrandingConfig = getBrandingConfig;
const saveBrandingConfig = async (config) => {
    await fs_1.default.promises.mkdir(path_1.default.dirname(brandingFilePath), { recursive: true });
    await fs_1.default.promises.writeFile(brandingFilePath, JSON.stringify(config, null, 2), 'utf-8');
};
exports.saveBrandingConfig = saveBrandingConfig;
