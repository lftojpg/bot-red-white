const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const express = require('express');

// Configurar mini servidor web para mantener el puerto abierto en Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🔴⚪ Bot Red-White está activo 24/7 en la nube.');
});

app.listen(PORT, () => {
    console.log(`Servidor web corriendo en el puerto ${PORT}`);
});

const DB_FILE = './database.json';
const SESSION_DIR = './sesion_red_white';
const FIXED_PHONE_NUMBER = '51901364783';

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
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ["Chrome (Linux)", "", ""] // Simula un navegador web para evitar bloqueos
    });

    if (!sock.authState.creds.registered) {
        // Esperar 10 segundos para asegurar que la conexión de red esté estable antes de pedir el pairing code
        setTimeout(async () => {
            try {
                console.log('Solicitando código de vinculación a WhatsApp...');
                let code = await sock.requestPairingCode(FIXED_PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`\n========================================`);
                console.log(`CÓDIGO DE VINCULACIÓN: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.log('Error al solicitar el código (se reintentará):', error.message);
            }
        }, 10000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log('Conexión cerrada por motivo:', statusCode);
            
            // Si hay error 401 (Unauthorized) o sesión inválida, limpiamos para reintentar limpio
            if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
                console.log('Limpiando sesión por error de autenticación...');
                if (fs.existsSync(SESSION_DIR)) {
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                }
            }
            
            console.log('Reiniciando conexión en 8 segundos...');
            setTimeout(() => startBot(), 8000);
        } else if (connection === 'open') {
            console.log('¡Bot red-white conectado exitosamente en la nube 24/7!');
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

        if (!command) return;

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

        if (command === '.menu' || command === '.help' || command === 'menu') {
            const menuText = `
🔴⚪ *BOT RED-WHITE - MENÚ PRINCIPAL* ⚪🔴

👤 *Usuario:* ${userPhone}
👑 *Estado VIP:* ${userData.vip ? 'ACTIVO' : 'INACTIVO'}
💳 *Créditos:* ${userData.credits}

📌 *Comandos Generales:*
• *.register* - Simular registro y activar VIP (10 créditos extra)
• *.perfil* - Ver estado de tu cuenta y créditos

🔍 *Comandos de Consulta:*
• *.dni [número]* - Simular consulta de datos por DNI
• *.num [número]* - Simular consulta de titular por número

💻 *Comandos de Simulación (Hack):*
• *.hackwsp [número]* - Simular hackeo de WhatsApp
• *.hackfb [usuario]* - Simular hackeo de Facebook
• *.hacktt [usuario]* - Simular hackeo de TikTok
            `.trim();
            return await sock.sendMessage(sender, { text: menuText }, { quoted: m });
        }

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

        if (!userData.registered) {
            return await sock.sendMessage(sender, { 
                text: '❌ Debes registrarte primero para usar este bot.\nUsa el comando: *.register*' 
            }, { quoted: m });
        }

        if (command === '.perfil') {
            return await sock.sendMessage(sender, { 
                text: `📊 *TUS DATOS - RED-WHITE*\n\n- Teléfono: ${userPhone}\n- Registrado: Sí\n- VIP: ${userData.vip ? 'Sí' : 'No'}\n- Créditos disponibles: ${userData.credits}` 
            }, { quoted: m });
        }

        if (['.dni', '.num', '.hackwsp', '.hackfb', '.hacktt'].includes(command)) {
            if (userData.credits <= 0 && !userData.vip) {
                return await sock.sendMessage(sender, { text: '❌ No tienes créditos suficientes. Usa .register o espera recarga.' });
            }

            if (!userData.vip) {
                userData.credits -= 1;
                saveDatabase(db);
            }

            const queryParam = args.join(' ');
            if (!queryParam) {
                return await sock.sendMessage(sender, { text: `⚠️ Debes ingresar un objetivo. Ejemplo: \`${command} 999888777\` o \`@usuario\`` });
            }

            if (command === '.dni') {
                await sock.sendMessage(sender, { text: `⏳ Iniciando búsqueda en RENIEC para DNI: ${queryParam}...` });
                setTimeout(async () => {
                    const res = `🔍 *RESULTADO [DNI]*\n🆔 DNI: ${queryParam}\n👤 Titular: PEZO FLORES, Jhey Lizardo\n📍 Ubigeo: Lima - San Juan de Lurigancho\n🎂 F. Nacimiento: 01/01/2004\n💳 Créditos: ${userData.vip ? 'VIP (Ilimitados)' : userData.credits}`;
                    await sock.sendMessage(sender, { text: res }, { quoted: m });
                }, 1500);
            } else if (command === '.num') {
                await sock.sendMessage(sender, { text: `⏳ Rastreando número ${queryParam}...` });
                setTimeout(async () => {
                    const res = `📱 *RESULTADO [NÚMERO]*\n📞 Número: ${queryParam}\n👤 Propietario: PEZO FLORES, Jhey Lizardo\n📡 Operador: Entel Perú\n📍 Ubicación: Lima, SJL\n💳 Créditos: ${userData.vip ? 'VIP' : userData.credits}`;
                    await sock.sendMessage(sender, { text: res }, { quoted: m });
                }, 1500);
            } else if (command === '.hackwsp') {
                await sock.sendMessage(sender, { text: `💻 [WHATSAPP HACK] Conectando al target: ${queryParam}...\n🔓 Bypass de cifrado de extremo a extremo en proceso...` });
                setTimeout(async () => {
                    const res = `🔥 *¡HACKEO EXITOSO DE WHATSAPP!* 🔥\n\nTarget: ${queryParam}\n💬 Chats extraídos: 1,420\n🔑 Clave de sesión: WA_SECURE_99182\n\n✅ *Información simulada enviada con éxito al objetivo.*`;
                    await sock.sendMessage(sender, { text: res }, { quoted: m });
                }, 2500);
            } else if (command === '.hackfb') {
                await sock.sendMessage(sender, { text: `💻 [FACEBOOK HACK] Analizando perfil de ${queryParam}...\n🍪 Extrayendo cookies de sesión y token de acceso...` });
                setTimeout(async () => {
                    const res = `🔥 *¡HACKEO EXITOSO DE FACEBOOK!* 🔥\n\nCuenta: @${queryParam}\n🔑 Contraseña (Hash): $2y$10$RedWhiteHacker...\n📥 Amigos totales: 842\n\n✅ *Acceso simulado a cuenta obtenido correctamente.*`;
                    await sock.sendMessage(sender, { text: res }, { quoted: m });
                }, 2500);
            } else if (command === '.hacktt') {
                await sock.sendMessage(sender, { text: `💻 [TIKTOK HACK] Conectando con API de TikTok para el usuario @${queryParam}...\n📥 Descargando borradores y métricas ocultas...` });
                setTimeout(async () => {
                    const res = `🔥 *¡HACKEO EXITOSO DE TIKTOK!* 🔥\n\nUsuario: @${queryParam}\n👁️ Vistas totales: 45.2K\n🎁 Monedas en cartera: 1,250\n\n✅ *Simulación de acceso y extracción completada.*`;
                    await sock.sendMessage(sender, { text: res }, { quoted: m });
                }, 2500);
            }
        }
    });
}

startBot();
