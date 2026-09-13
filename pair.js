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
import pn from "awesome-phonenumber";
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
    let num = req.query.number;
    let dirs = "./" + (num || `session`);

    await removeFile(dirs);

    num = num.replace(/[^0-9]/g, "");

    const phone = pn("+" + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({
                code: "Invalid phone number. Please enter your full international number without + or spaces.",
            });
        }
        return;
    }
    num = phone.getNumber("e164").replace("+", "");
    const sessionId = "pair_" + num;

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let KnightBot = makeWASocket({
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
                const { connection, lastDisconnect } = update;

                if (connection === "open") {
                    console.log("✅ Connected successfully!");
                    console.log("📱 Saving session to MongoDB...");

                    try {
                        const credsPath = dirs + "/creds.json";
                        await saveSessionToMongo(sessionId, credsPath);

                        const userJid = jidNormalizedUser(num + "@s.whatsapp.net");
                        await KnightBot.sendMessage(userJid, {
                            text: "Connecting Sachiya Md",
                        });
                        console.log("📄 Success message sent to inbox");

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

            if (!KnightBot.authState.creds.registered) {
                await delay(3000);
                let codeNum = num.replace(/[^\d+]/g, "");
                if (codeNum.startsWith("+")) codeNum = codeNum.substring(1);

                try {
                    let code = await KnightBot.requestPairingCode(codeNum);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    if (!res.headersSent) {
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error("Error requesting pairing code:", error);
                    if (!res.headersSent) {
                        res.status(503).send({
                            code: "Failed to get pairing code. Please check your phone number and try again.",
                        });
                    }
                    setTimeout(() => process.exit(1), 2000);
                }
            }

            KnightBot.ev.on("creds.update", saveCreds);
        } catch (err) {
            console.error("Error initializing session:", err);
            if (!res.headersSent) {
                res.status(503).send({ code: "Service Unavailable" });
            }
            setTimeout(() => process.exit(1), 2000);
        }
    }

    await initiateSession();
});

export default router;
