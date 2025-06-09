"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const multer_1 = __importDefault(require("multer"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// 👉 On utilise memoryStorage pour accéder au buffer du fichier
const storage = multer_1.default.memoryStorage();
const upload = (0, multer_1.default)({ storage });
exports.default = upload;
