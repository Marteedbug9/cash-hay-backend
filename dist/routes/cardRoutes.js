"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/cardRoutes.ts
const express_1 = require("express");
const cardController_1 = require("../controllers/cardController");
const verifyToken_1 = require("../middlewares/verifyToken");
const router = (0, express_1.Router)();
router.post('/request', verifyToken_1.verifyToken, cardController_1.requestCard);
router.post('/cancel', verifyToken_1.verifyToken, cardController_1.cancelCard);
router.post('/toggle-lock', verifyToken_1.verifyToken, cardController_1.toggleCardLock);
exports.default = router;
