const { default: makeWASocket, useMultiFileAuthState, delay, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const express = require('express');
const { Storage } = require('megajs');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Mega Upload Helper Function
async function uploadSessionToMega(sessionPath, phoneNumber) {
    try {
        const storage = new Storage({
            email: 'sachirainduwara239@gmail.com',
            password: 'Sachi@2010'
        });

        await new Promise((resolve, reject) => {
            storage.ready(err => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Create a folder for sessions if it doesn't exist
        let folder = storage.root.children.find(f => f.name === 'SACHIYA_MD_SESSIONS' && f.directory);
        if (!folder) {
            folder = await new Promise((resolve, reject) => {
                storage.root.createFolder('SACHIYA_MD_SESSIONS', (err, folder) => {
                    if (err) reject(err);
                    else resolve(folder);
                });
            });
        }

        // Zip or upload creds.json directly
        const credsPath = path.join(sessionPath, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const fileData = fs.readFileSync(credsPath);
            // Check if file already exists in folder, delete old one
            const existingFile = folder.children.find(f => f.name === `${phoneNumber}.json`);
            if (existingFile) {
                await new Promise((res) => existingFile.delete(res));
            }

            await new Promise((resolve, reject) => {
                folder.upload({ name: `${phoneNumber}.json`, size: fileData.length }, fileData, (err, file) => {
                    if (err) reject(err);
                    else resolve(file);
                });
            });
            console.log(`Session for ${phoneNumber} successfully uploaded to Mega!`);
        }
    } catch (e) {
        console.error('Error uploading session to Mega:', e);
    }
}

app.get('/pair', async (req, res) => {
    let phoneNumber = req.query.phone;
    if (!phoneNumber) {
        return res.json({ error: 'Phone number is required' });
    }

    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
    const sessionDir = path.join(__dirname, `session_${phoneNumber}`);

    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    try {
        const Sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
            },
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }),
            browser: Browsers.ubuntu('Chrome') // Ubuntu / Chrome device link configuration
        });

        if (!Sock.authState.creds.registered) {
            await delay(1500);
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
            let code = await Sock.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            
            res.json({ code });
        } else {
            res.json({ error: 'Number is already registered!' });
        }

        Sock.ev.on('creds.update', saveCreds);

        Sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                console.log(`WhatsApp Connected Successfully for ${phoneNumber}`);
                await delay(5000); // Wait for full sync
                
                // Upload session to Mega
                await uploadSessionToMega(sessionDir, phoneNumber);
                
                // Cleanup local temp session files
                rimraf.sync(sessionDir);
            }
        });

    } catch (err) {
        console.error(err);
        rimraf.sync(sessionDir);
        if (!res.headersSent) {
            res.json({ error: 'Service Unavailable or Invalid Number.' });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
