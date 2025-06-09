"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchUserByContact = exports.uploadProfileImage = exports.validateIdentity = exports.verifyOTP = exports.confirmSuspiciousAttempt = exports.resendOTP = exports.uploadIdentity = exports.resetPassword = exports.verifyEmailForRecovery = exports.startRecovery = exports.getProfile = exports.login = exports.register = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const db_1 = __importDefault(require("../config/db"));
const notificationUtils_1 = require("../utils/notificationUtils");
const uuid_1 = require("uuid");
const cloudinary_1 = __importDefault(require("../config/cloudinary"));
const request_ip_1 = __importDefault(require("request-ip"));
const streamifier_1 = __importDefault(require("streamifier"));
// ➤ Enregistrement
const register = async (req, res) => {
    console.log('🟡 Données reçues:', req.body);
    const { first_name, last_name, gender, address, city, department, zip_code = '', country, email, phone, birth_date, birth_country, birth_place, id_type, id_number, id_issue_date, id_expiry_date, username, password, accept_terms } = req.body;
    const usernameRegex = /^[a-zA-Z0-9@#%&._-]{3,30}$/;
    if (!username || !usernameRegex.test(username)) {
        return res.status(400).json({
            error: "Nom d’utilisateur invalide. Seuls les caractères alphanumériques et @ # % & . _ - sont autorisés (3-30 caractères)."
        });
    }
    // ✅ Vérification des champs requis
    if (!first_name || !last_name || !gender || !address || !city || !department || !country ||
        !email || !phone ||
        !birth_date || !birth_country || !birth_place ||
        !id_type || !id_number || !id_issue_date || !id_expiry_date ||
        !username || !password || accept_terms !== true) {
        return res.status(400).json({ error: 'Tous les champs sont requis.' });
    }
    try {
        const userId = (0, uuid_1.v4)();
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const recoveryCode = (0, uuid_1.v4)();
        const result = await db_1.default.query(`INSERT INTO users (
        id, first_name, last_name, gender, address, city, department, zip_code, country,
        email, phone,
        birth_date, birth_country, birth_place,
        id_type, id_number, id_issue_date, id_expiry_date,
        username, password_hash, role, accept_terms, recovery_code
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11,
        $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, $21, $22, $23
      ) RETURNING id, email, first_name, last_name, username`, [
            userId, first_name, last_name, gender, address, city, department, zip_code, country,
            email, phone,
            birth_date, birth_country, birth_place,
            id_type, id_number, id_issue_date, id_expiry_date,
            username, hashedPassword, 'user', true, recoveryCode
        ]);
        // ✅ Création du solde initial à 0
        await db_1.default.query('INSERT INTO balances (user_id, amount) VALUES ($1, $2)', [userId, 0]);
        // ✅ Envoi Email
        await (0, notificationUtils_1.sendEmail)({
            to: email,
            subject: 'Bienvenue sur Cash Hay',
            text: `Bonjour ${first_name},\n\nBienvenue sur Cash Hay ! Votre compte a été créé avec succès. Veuillez compléter la vérification d'identité pour l'activation.\n\nL'équipe Cash Hay.`
        });
        // ✅ Envoi SMS
        await (0, notificationUtils_1.sendSMS)(phone, `Bienvenue ${first_name} ! Votre compte Cash Hay est créé. Complétez votre vérification d'identité pour l'activer.`);
        return res.status(201).json({ user: result.rows[0] });
    }
    catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Email ou nom d’utilisateur déjà utilisé.' });
        }
        console.error('❌ Erreur SQL :', err.message);
        console.error('📄 Détail complet :', err);
        return res.status(500).json({ error: 'Erreur serveur.' });
    }
};
exports.register = register;
// ➤ Connexion
const login = async (req, res) => {
    console.log('🟡 Requête login reçue avec :', req.body);
    const { username, password } = req.body;
    const ip = request_ip_1.default.getClientIp(req);
    try {
        const result = await db_1.default.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Nom d’utilisateur ou mot de passe incorrect.' });
        }
        const user = result.rows[0];
        const isMatch = await bcrypt_1.default.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Nom d’utilisateur ou mot de passe incorrect.' });
        }
        if (user.is_deceased) {
            return res.status(403).json({ error: 'Ce compte est marqué comme décédé.' });
        }
        if (user.is_blacklisted) {
            return res.status(403).json({ error: 'Ce compte est sur liste noire.' });
        }
        // 🔍 Vérifie si l'IP a déjà été utilisée
        const ipResult = await db_1.default.query('SELECT * FROM login_history WHERE user_id = $1 AND ip_address = $2', [user.id, ip]);
        const isNewIP = ipResult.rowCount === 0;
        // ✅ Génère OTP seulement si IP nouvelle OU is_otp_verified = false
        const requiresOTP = !user.is_otp_verified || isNewIP;
        if (requiresOTP) {
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            await db_1.default.query('DELETE FROM otps WHERE user_id = $1', [user.id]);
            const otpInsert = await db_1.default.query(`INSERT INTO otps (user_id, code, created_at, expires_at)
   VALUES ($1, $2, NOW(), NOW() + INTERVAL '10 minutes')`, [user.id, code]);
            console.log('✅ OTP enregistré:', otpInsert.rowCount);
            console.log(`📩 Code OTP pour ${user.username} : ${code}`);
        }
        else {
            // ✅ Enregistre l'IP si déjà vérifié et connue
            await db_1.default.query('INSERT INTO login_history (user_id, ip_address) VALUES ($1, $2)', [user.id, ip]);
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, role: user.role || 'user' }, process.env.JWT_SECRET || 'devsecretkey', { expiresIn: '1h' });
        res.status(200).json({
            message: 'Connexion réussie',
            requiresOTP,
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                phone: user.phone, // facultatif
                full_name: `${user.first_name} ${user.last_name}`,
                is_verified: user.is_verified || false,
                verified_at: user.verified_at || null, // ✅ ajoute ceci
                identity_verified: user.identity_verified || false, // 👈 ici
                is_otp_verified: user.is_otp_verified || false, // 🔥 important
                role: user.role || 'user',
            }
        });
    }
    catch (error) {
        console.error('❌ Erreur dans login:', error.message);
        console.error('🔎 Stack trace:', error.stack);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
};
exports.login = login;
// ➤ Récupération de profil
const getProfile = async (req, res) => {
    const userId = req.user?.id;
    try {
        const result = await db_1.default.query('SELECT id, first_name, last_name, username, email FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé.' });
        }
        res.json({ user: result.rows[0] });
    }
    catch (err) {
        console.error('❌ Erreur profil:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
};
exports.getProfile = getProfile;
// ➤ Démarrer récupération de compte
const startRecovery = async (req, res) => {
    const { credentialType, value } = req.body;
    try {
        let user;
        if (credentialType === 'username') {
            const result = await db_1.default.query('SELECT id, email FROM users WHERE username = $1', [value]);
            user = result.rows[0];
        }
        else {
            const result = await db_1.default.query('SELECT id, email FROM users WHERE email = $1', [value]);
            user = result.rows[0];
        }
        if (!user)
            return res.status(404).json({ error: 'Utilisateur non trouvé.' });
        const maskedEmail = user.email.slice(0, 4) + '***@***';
        res.json({ message: 'Email masqué envoyé.', maskedEmail, userId: user.id });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
};
exports.startRecovery = startRecovery;
// ➤ Envoi OTP pour récupération
const verifyEmailForRecovery = async (req, res) => {
    const { userId, verifiedEmail } = req.body;
    try {
        const result = await db_1.default.query('SELECT email FROM users WHERE id = $1', [userId]);
        const user = result.rows[0];
        if (!user || user.email !== verifiedEmail) {
            return res.status(401).json({ error: 'Adresse email non valide.' });
        }
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await db_1.default.query('UPDATE users SET recovery_code = $1 WHERE id = $2', [otp, userId]);
        await (0, notificationUtils_1.sendEmail)({
            to: user.email,
            subject: 'Code OTP - Cash Hay',
            text: `Votre code est : ${otp}`
        });
        await (0, notificationUtils_1.sendSMS)(user.email, `Cash Hay : Votre code OTP est : ${otp}`);
        res.json({ message: 'Code OTP envoyé par SMS et Email.' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
};
exports.verifyEmailForRecovery = verifyEmailForRecovery;
// ➤ Réinitialisation mot de passe
const resetPassword = async (req, res) => {
    const { userId, otp, newPassword } = req.body;
    try {
        const result = await db_1.default.query('SELECT recovery_code FROM users WHERE id = $1', [userId]);
        const user = result.rows[0];
        if (!user || user.recovery_code !== otp) {
            return res.status(401).json({ error: 'Code OTP invalide.' });
        }
        const hashedPassword = await bcrypt_1.default.hash(newPassword, 10);
        await db_1.default.query('UPDATE users SET password_hash = $1, recovery_code = NULL WHERE id = $2', [hashedPassword, userId]);
        res.json({ message: 'Mot de passe réinitialisé avec succès.' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
};
exports.resetPassword = resetPassword;
// ➤ Upload de pièce d'identité + activation
const uploadIdentity = async (req, res) => {
    try {
        const userId = req.user?.id;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];
        const files = req.files;
        const faceFile = files?.face?.[0];
        const documentFile = files?.document?.[0];
        if (!faceFile || !documentFile) {
            return res.status(400).json({ error: 'Photos manquantes (visage ou pièce).' });
        }
        // Fonction d'upload vers Cloudinary
        const uploadToCloudinary = (fileBuffer, folder) => {
            return new Promise((resolve, reject) => {
                const stream = cloudinary_1.default.uploader.upload_stream({ folder }, (error, result) => {
                    if (error || !result)
                        return reject(error);
                    resolve(result.secure_url);
                });
                stream.end(fileBuffer);
            });
        };
        const [faceUrl, documentUrl] = await Promise.all([
            uploadToCloudinary(faceFile.buffer, 'cash-hay/identities/face'),
            uploadToCloudinary(documentFile.buffer, 'cash-hay/identities/document')
        ]);
        // 🔒 Mise à jour utilisateur (attente d'approbation admin)
        await db_1.default.query(`UPDATE users 
       SET face_url = $1,
           document_url = $2,
           identity_verified = false,
           is_verified = false,
           verified_at = NULL,
           identity_request_enabled = false
       WHERE id = $3`, [faceUrl, documentUrl, userId]);
        // 🧾 Journalisation
        await db_1.default.query(`INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`, [
            userId,
            'upload_identity',
            `Vérification identité : photo visage et pièce soumises.`,
            ip?.toString(),
            userAgent || 'N/A'
        ]);
        console.log('📥 uploadIdentity exécuté avec succès pour', userId);
        return res.status(200).json({
            message: 'Documents soumis avec succès. En attente de validation.',
            faceUrl,
            documentUrl
        });
    }
    catch (error) {
        console.error('❌ Erreur upload identité:', error);
        return res.status(500).json({ error: 'Erreur lors de l’envoi des fichiers.' });
    }
};
exports.uploadIdentity = uploadIdentity;
// ➤ Renvoyer un code OTP
const resendOTP = async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'ID utilisateur requis.' });
    }
    try {
        const userRes = await db_1.default.query('SELECT email, phone FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé.' });
        }
        const user = userRes.rows[0];
        // Vérifie les tentatives dans les 15 dernières minutes
        const since = new Date(Date.now() - 15 * 60 * 1000);
        const attemptsRes = await db_1.default.query(`SELECT COUNT(*) FROM otps 
       WHERE user_id = $1 AND created_at > $2`, [userId, since]);
        const attempts = parseInt(attemptsRes.rows[0].count);
        if (attempts >= 3) {
            // Bloque temporairement 30 minutes dans une table de blocage (ou attribut user)
            await db_1.default.query(`INSERT INTO otp_blocks (user_id, blocked_until) 
         VALUES ($1, $2) 
         ON CONFLICT (user_id) DO UPDATE SET blocked_until = $2`, [userId, new Date(Date.now() + 30 * 60 * 1000)]);
            // Envoyer email et SMS d'alerte
            await (0, notificationUtils_1.sendEmail)({
                to: user.email,
                subject: 'Tentatives excessives de vérification - Cash Hay',
                text: `Nous avons détecté plus de 3 tentatives de code en 15 minutes. Si ce n'était pas vous, cliquez ici pour signaler : Y/N. Votre compte est temporairement bloqué 30 minutes.`,
            });
            await (0, notificationUtils_1.sendSMS)(user.phone, `Cash Hay : Trop de tentatives OTP. Votre compte est bloqué 30 min. Répondez Y ou N pour valider.`);
            return res.status(429).json({
                error: 'Trop de tentatives. Votre compte est bloqué 30 minutes. Contactez le support si besoin.'
            });
        }
        // Vérifie si le compte est bloqué
        const blockCheck = await db_1.default.query(`SELECT blocked_until FROM otp_blocks WHERE user_id = $1`, [userId]);
        if (blockCheck.rows.length > 0) {
            const blockedUntil = new Date(blockCheck.rows[0].blocked_until);
            if (blockedUntil > new Date()) {
                return res.status(403).json({
                    error: `Ce compte est temporairement bloqué jusqu'à ${blockedUntil.toLocaleTimeString()}`
                });
            }
        }
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 10 * 60000); // 10 minutes
        await db_1.default.query('INSERT INTO otps (user_id, code, created_at, expires_at) VALUES ($1, $2, $3, $4)', [userId, otp, now, expiresAt]);
        await (0, notificationUtils_1.sendEmail)({
            to: user.email,
            subject: 'Code de vérification - Cash Hay',
            text: `Votre code est : ${otp}`,
        });
        await (0, notificationUtils_1.sendSMS)(user.phone, `Cash Hay : Votre code OTP est : ${otp}`);
        res.status(200).json({ message: 'Code renvoyé avec succès.' });
    }
    catch (err) {
        console.error('Erreur lors du renvoi OTP:', err);
        res.status(500).json({ error: 'Erreur serveur lors du renvoi du code.' });
    }
};
exports.resendOTP = resendOTP;
// ➤ Confirmation de sécurité (réponse Y ou N
const confirmSuspiciousAttempt = async (req, res) => {
    const { userId, response } = req.body;
    if (!userId || !['Y', 'N'].includes(response)) {
        return res.status(400).json({ error: 'Requête invalide.' });
    }
    try {
        const result = await db_1.default.query('SELECT email FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur introuvable.' });
        }
        if (response === 'N') {
            await db_1.default.query('UPDATE users SET is_blacklisted = true WHERE id = $1', [userId]);
            return res.status(200).json({ message: 'Compte bloqué. Veuillez contacter le support.' });
        }
        else {
            return res.status(200).json({ message: 'Tentative confirmée. Accès restauré après le délai.' });
        }
    }
    catch (err) {
        console.error('Erreur de confirmation de sécurité :', err);
        res.status(500).json({ error: 'Erreur serveur lors de la confirmation.' });
    }
};
exports.confirmSuspiciousAttempt = confirmSuspiciousAttempt;
// ➤ Vérification OTP après login
const verifyOTP = async (req, res) => {
    const { userId, code } = req.body;
    if (!userId || !code) {
        return res.status(400).json({ error: 'ID utilisateur et code requis.' });
    }
    try {
        const otpRes = await db_1.default.query('SELECT code, expires_at FROM otps WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
        if (otpRes.rows.length === 0) {
            console.log('⛔ Aucun code OTP trouvé pour cet utilisateur');
            return res.status(400).json({ valid: false, reason: 'Expired or invalid code.' });
        }
        const { code: storedCode, expires_at } = otpRes.rows[0];
        const now = new Date();
        if (now > new Date(expires_at)) {
            console.log('⏰ Code OTP expiré');
            return res.status(400).json({ valid: false, reason: 'Code expiré.' });
        }
        const receivedCode = String(code).trim();
        const expectedCode = String(storedCode).trim();
        console.log(`📥 Code reçu: "${receivedCode}" (longueur: ${receivedCode.length})`);
        console.log(`📦 Code attendu: "${expectedCode}" (longueur: ${expectedCode.length})`);
        if (receivedCode !== expectedCode) {
            console.log('❌ Code incorrect (comparaison échouée)');
            return res.status(400).json({ error: 'Code invalide.' });
        }
        // ✅ Marquer l’utilisateur comme vérifié
        await db_1.default.query('UPDATE users SET is_otp_verified = true WHERE id = $1', [userId]);
        // ✅ Supprimer les OTP anciens
        await db_1.default.query('DELETE FROM otps WHERE user_id = $1', [userId]);
        // 🔁 Regénérer le token
        const userRes = await db_1.default.query('SELECT * FROM users WHERE id = $1', [userId]);
        const user = userRes.rows[0];
        const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'devsecretkey', { expiresIn: '24h' });
        console.log('✅ Code OTP validé avec succès');
        return res.status(200).json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                phone: user.phone,
                full_name: `${user.first_name} ${user.last_name}`,
                is_verified: user.is_verified,
                is_otp_verified: true,
                identity_verified: user.identity_verified,
                identity_request_enabled: user.identity_request_enabled,
                role: user.role,
            },
        });
    }
    catch (err) {
        console.error('❌ Erreur vérification OTP:', err.message);
        return res.status(500).json({ error: 'Erreur serveur.' });
    }
};
exports.verifyOTP = verifyOTP;
// ➤ Vérification  validation ID
const validateIdentity = async (req, res) => {
    const { id } = req.params;
    try {
        await db_1.default.query(`UPDATE users SET identity_verified = true, verified_at = NOW() WHERE id = $1`, [id]);
        return res.status(200).json({ message: 'Identité validée avec succès.' });
    }
    catch (err) {
        console.error('❌ Erreur validation identité:', err);
        res.status(500).json({ error: 'Erreur lors de la validation.' });
    }
};
exports.validateIdentity = validateIdentity;
// 📤 Upload photo de profil
const uploadProfileImage = async (req, res) => {
    try {
        const userId = req.user?.id;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'Aucune image reçue' });
        }
        const uploadFromBuffer = (fileBuffer) => {
            return new Promise((resolve, reject) => {
                const stream = cloudinary_1.default.uploader.upload_stream({
                    folder: 'cash-hay/profiles',
                    public_id: `profile_${userId}`,
                    resource_type: 'image',
                    format: 'jpg',
                }, (error, result) => {
                    if (error)
                        return reject(error);
                    resolve(result);
                });
                streamifier_1.default.createReadStream(fileBuffer).pipe(stream);
            });
        };
        const result = await uploadFromBuffer(file.buffer);
        await db_1.default.query('UPDATE users SET profile_image = $1 WHERE id = $2', [
            result.secure_url,
            userId,
        ]);
        res.status(200).json({ imageUrl: result.secure_url });
    }
    catch (err) {
        console.error('❌ Erreur upload image :', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};
exports.uploadProfileImage = uploadProfileImage;
// 🔍 Recherche d'utilisateur par email ou téléphone
const searchUserByContact = async (req, res) => {
    const contact = req.query.contact;
    if (!contact) {
        return res.status(400).json({ error: 'Contact manquant ou invalide' });
    }
    try {
        const { rows } = await db_1.default.query('SELECT id, full_name, profile_image AS photo_url FROM users WHERE email = $1 OR phone = $1', [contact]);
        if (rows.length === 0) {
            return res.status(404).json({ exists: false });
        }
        return res.json({ exists: true, user: rows[0] });
    }
    catch (err) {
        console.error('❌ Erreur recherche utilisateur :', err);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
};
exports.searchUserByContact = searchUserByContact;
