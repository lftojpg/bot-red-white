const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');
const fs = require('fs');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const DB_FILE = './database.json';

function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDatabase(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_red_white');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    if (!sock.authState.creds.registered) {
        let phoneNumber = await question('Ingresa tu número de WhatsApp (ej: 519XXXXXXXX): ');
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        setTimeout(async () => {
            let code = await sock.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join('-') || code;
            console.log(`\n========================================`);
            console.log(`CÓDIGO DE VINCULACIÓN: ${code}`);
            console.log(`========================================\n`);
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) { startBot(); }
        } else if (connection === 'open') {
            console.log('¡Bot red-white conectado exitosamente!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const messageType = Object.keys(m.message)[0];
        const body = messageType === 'conversation' ? m.message.conversation :
                     messageType === 'extendedTextMessage' ? m.message.extendedTextMessage.text : '';

        const sender = m.key.remoteJid;
        const userPhone = sender.split('@')[0];
        const args = body.trim().split(/ +/);
        const command = args.shift().toLowerCase();

        let db = loadDatabase();

        if (!db.users[userPhone]) {
            db.users[userPhone] = {
                registered: false,
                vip: false,
                credits: 3
            };
            saveDatabase(db);
        }

        const userData = db.users[userPhone];

        if (command === '.register') {
            if (userData.registered) {
                return await sock.sendMessage(sender, { text: '⚠️ Ya te encuentras registrado en el sistema de red-white.' }, { quoted: m });
            }
            userData.registered = true;
            userData.vip = true;
            userData.credits += 10;
            saveDatabase(db);

            return await sock.sendMessage(sender, { 
                text: '✅ *¡Registro exitoso en red-white!*\n\n👑 Acceso VIP activado temporalmente.\n🎁 Se te han otorgado 10 créditos adicionales.' 
            }, { quoted: m });
        }

        if (!userData.registered && command !== '.menu') {
            return await sock.sendMessage(sender, { 
                text: '❌ Debes registrarte primero para usar este bot.\nUsa el comando: *.register*' 
            }, { quoted: m });
        }

        if (command === '.menu' || command === '.help') {
            const menuText = `
🔴⚪ *BOT RED-WHITE - MENÚ PRINCIPAL* ⚪🔴

👤 *Usuario:* ${userPhone}
👑 *Estado VIP:* ${userData.vip ? 'ACTIVO' : 'INACTIVO'}
💳 *Créditos:* ${userData.credits}

📌 *Comandos Disponibles:*
• *.register* - Simular registro y activar VIP
• *.dni [número]* - Simular consulta de datos por DNI
• *.num [número]* - Simular consulta de titular por número
• *.perfil* - Ver estado de tu cuenta y créditos
            `.trim();
            return await sock.sendMessage(sender, { text: menuText }, { quoted: m });
        }

        if (command === '.perfil') {
            return await sock.sendMessage(sender, { 
                text: `📊 *TUS DATOS - RED-WHITE*\n\n- Teléfono: ${userPhone}\n- Registrado: Sí\n- VIP: ${userData.vip ? 'Sí' : 'No'}\n- Créditos disponibles: ${userData.credits}` 
            }, { quoted: m });
        }

        if (command === '.dni' || command === '.num') {
            if (userData.credits <= 0 && !userData.vip) {
                return await sock.sendMessage(sender, { text: '❌ No tienes créditos suficientes.' });
            }

            if (!userData.vip) {
                userData.credits -= 1;
                saveDatabase(db);
            }

            const queryParam = args.join(' ');
            if (!queryParam) {
                return await sock.sendMessage(sender, { text: `⚠️ Debes ingresar un parámetro. Ejemplo: \`${command} 12345678\`` });
            }

            if (command === '.dni') {
                setTimeout(async () => {
                    const resultadoDNI = `
🔍 *RESULTADO DE CONSULTA [DNI]* 🔍
-----------------------------------
🆔 *DNI:* ${queryParam}
👤 *Titular:* PEZO FLORES, Jhey Lizardo
📍 *Ubigeo:* Lima - San Juan de Lurigancho
🎂 *F. Nacimiento:* 01/01/2004
-----------------------------------
💳 *Créditos restantes:* ${userData.vip ? 'VIP (Ilimitados)' : userData.credits}
                    `.trim();
                    await sock.sendMessage(sender, { text: resultadoDNI }, { quoted: m });
                }, 1000);
            } else if (command === '.num') {
                setTimeout(async () => {
                    const resultadoNum = `
📱 *RESULTADO DE CONSULTA [NÚMERO]* 📱
-----------------------------------
📞 *Número:* ${queryParam}
👤 *Titular Registrado:* PEZO FLORES, Jhey Lizardo
📡 *Operador:* Entel / Movistar (Simulado)
📍 *Estado:* Activo / Línea a nombre de titular
-----------------------------------
💳 *Créditos restantes:* ${userData.vip ? 'VIP (Ilimitados)' : userData.credits}
                    `.trim();
                    await sock.sendMessage(sender, { text: resultadoNum }, { quoted: m });
                }, 1000);
            }
        }
    });
}

startBot();
