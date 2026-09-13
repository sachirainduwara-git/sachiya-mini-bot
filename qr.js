import express from "express";
import fs from "fs";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { saveSessionToMongo } from "./database.js";

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error("Error removing file:", e);
    }
}

router.get("/", async (req, res) => {
    const sessionId = "qr_" + Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync("./qr_sessions")) {
        fs.mkdirSync("./qr_sessions", { recursive: true });
    }

    await removeFile(dirs);

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let responseSent = false;

            const KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" }).child({ level: "fatal" }),
                    ),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows("Chrome"),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            KnightBot.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline, qr } = update;

                if (qr && !responseSent) {
                    console.log("🟢 QR Code Generated! Scan it with your WhatsApp app.");

                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, {
                            errorCorrectionLevel: "M",
                            type: "image/png",
                            quality: 0.92,
                            margin: 1,
                            color: { dark: "#000000", light: "#FFFFFF" },
                        });

                        if (!responseSent) {
                            responseSent = true;
                            res.send({
                                qr: qrDataURL,
                                message: "QR Code Generated! Scan it with your WhatsApp app.",
                                instructions: [
                                    "1. Open WhatsApp on your phone",
                                    "2. Go to Settings > Linked Devices",
                                    '3. Tap "Link a Device"',
                                    "4. Scan the QR code above",
                                ],
                            });
                        }
                    } catch (qrError) {
                        console.error("Error generating QR code:", qrError);
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).send({ code: "Failed to generate QR code" });
                        }
                    }
                }

                if (connection === "open") {
                    console.log("✅ Connected successfully!");
                    console.log("📱 Saving session to MongoDB...");

                    try {
                        const credsPath = dirs + "/creds.json";
                        await saveSessionToMongo(sessionId, credsPath);

                        const userJid = jidNormalizedUser(KnightBot.authState.creds.me?.id || "");
                        if (userJid) {
                            await KnightBot.sendMessage(userJid, {
                                text: "Connecting Sachiya Md",
                            });
                            console.log("📄 Success message sent to inbox");
                        }

                        console.log("🧹 Cleaning up session...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("🎉 Process completed successfully!");

                        await delay(2000);
                        process.exit(0);
                    } catch (error) {
                        console.error("❌ Error saving session to MongoDB:", error);
                        removeFile(dirs);
                        await delay(2000);
                        process.exit(1);
                    }
                }

                if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode !== 401) {
                        initiateSession();
                    }
                }
            });

            KnightBot.ev.on("creds.update", saveCreds);

            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ code: "QR generation timeout" });
                    removeFile(dirs);
                    setTimeout(() => process.exit(1), 2000);
                }
            }, 30000);
        } catch (err) {
            console.error("Error initializing session:", err);
            if (!res.headersSent) {
                res.status(503).send({ code: "Service Unavailable" });
            }
            removeFile(dirs);
            setTimeout(() => process.exit(1), 2000);
        }
    }

    await initiateSession();
});

export default router;
