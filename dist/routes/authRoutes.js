"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authController_1 = require("../controllers/authController");
const upload_1 = __importDefault(require("../middlewares/upload"));
const verifyToken_1 = require("../middlewares/verifyToken");
const router = (0, express_1.Router)();
// Authentification
router.post('/register', authController_1.register);
router.post('/login', authController_1.login);
router.get('/profile', verifyToken_1.verifyToken, authController_1.getProfile);
// Recherche utilisateur
router.get('/search', verifyToken_1.verifyToken, authController_1.searchUserByContact);
// Récupération de compte / OTP
router.post('/recovery/start', authController_1.startRecovery);
router.post('/recovery/verify-email', authController_1.verifyEmailForRecovery);
router.post('/recovery/reset', authController_1.resetPassword);
// Upload identité
router.post('/verify-identity', verifyToken_1.verifyToken, upload_1.default.fields([
    { name: 'face', maxCount: 1 },
    { name: 'document', maxCount: 1 }
]), authController_1.uploadIdentity);
// OTP après login
router.post('/verify-otp', authController_1.verifyOTP);
router.post('/resend-otp', authController_1.resendOTP);
// Confirmation tentative suspecte
router.post('/confirm-suspicious-attempt', authController_1.confirmSuspiciousAttempt);
// Photo de profil
router.post('/upload-profile-image', verifyToken_1.verifyToken, upload_1.default.single('image'), authController_1.uploadProfileImage);
exports.default = router;
