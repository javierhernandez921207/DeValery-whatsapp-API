import { Client } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import express from "express";
import cors from "cors";

// Variables globales para manejar el estado
let currentQR = null;
let qrBase64 = null;
let isConnected = false;
let connectionStatus = 'disconnected';

const client = new Client({
    puppeteer: {
        headless: true, // no abre ventana
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Manejo de eventos de WhatsApp
client.on('qr', async (qr) => {
    console.log('📱 Nuevo código QR generado para iniciar sesión');
    qrcode.generate(qr, { small: true });
    
    // Guardar QR en diferentes formatos
    currentQR = qr;
    try {
        qrBase64 = await QRCode.toDataURL(qr);
        console.log('✅ Código QR disponible en /qr endpoint');
    } catch (error) {
        console.error('❌ Error generando QR base64:', error.message);
    }
    
    connectionStatus = 'qr_ready';
});

client.on('ready', () => {
    console.log('✅ WhatsApp conectado exitosamente!');
    isConnected = true;
    connectionStatus = 'connected';
    currentQR = null;
    qrBase64 = null;
});

client.on('authenticated', () => {
    console.log('🔐 WhatsApp autenticado');
    connectionStatus = 'authenticated';
});

client.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación:', msg);
    connectionStatus = 'auth_failed';
    isConnected = false;
});

client.on('disconnected', (reason) => {
    console.log('🔌 WhatsApp desconectado:', reason);
    isConnected = false;
    connectionStatus = 'disconnected';
    currentQR = null;
    qrBase64 = null;
});

client.initialize();

// API REST con seguridad
const app = express();

// Middleware de seguridad - Solo localhost
const localhostOnly = (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    const isLocalhost = clientIP === '127.0.0.1' || 
                       clientIP === '::1' || 
                       clientIP === '::ffff:127.0.0.1' ||
                       req.hostname === 'localhost';
    
    if (!isLocalhost) {
        console.log(`🚫 Acceso denegado desde IP: ${clientIP}`);
        return res.status(403).json({ 
            success: false, 
            error: 'Acceso denegado: Solo se permiten conexiones desde localhost' 
        });
    }
    next();
};

// Configurar CORS solo para localhost
app.use(cors({
    origin: ['http://localhost:5000', 'https://localhost:5001', 'http://localhost:3000'],
    credentials: true
}));

app.use(express.json({ limit: '1mb' })); // Limitar tamaño del body
app.use(localhostOnly); // Aplicar middleware de seguridad

// Validación de entrada
const validateInput = (req, res, next) => {
    const { number, message } = req.body;
    
    if (!number || !message) {
        return res.status(400).json({ 
            success: false, 
            error: 'Número y mensaje son requeridos' 
        });
    }
    
    if (typeof number !== 'string' || typeof message !== 'string') {
        return res.status(400).json({ 
            success: false, 
            error: 'Número y mensaje deben ser strings' 
        });
    }
    
    if (message.length > 1000) {
        return res.status(400).json({ 
            success: false, 
            error: 'El mensaje no puede exceder 1000 caracteres' 
        });
    }
    
    next();
};

app.post('/send', validateInput, async (req, res) => {
    const { number, message } = req.body;
    try {
        console.log(`📤 Enviando mensaje a: ${number}`);
        await client.sendMessage(`${number}@c.us`, message);
        res.json({ success: true, timestamp: new Date().toISOString() });
    } catch (error) {
        console.error(`❌ Error enviando mensaje: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint de salud para verificar que la API funciona
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        whatsapp: {
            connected: isConnected,
            status: connectionStatus,
            info: client.info ? {
                pushname: client.info.pushname,
                wid: client.info.wid._serialized
            } : null
        },
        timestamp: new Date().toISOString() 
    });
});

// Endpoint para obtener el código QR
app.get('/qr', (req, res) => {
    if (!currentQR || !qrBase64) {
        return res.status(404).json({
            success: false,
            error: 'No hay código QR disponible',
            status: connectionStatus,
            message: connectionStatus === 'connected' ? 'WhatsApp ya está conectado' : 'No se ha generado un código QR aún'
        });
    }

    res.json({
        success: true,
        qrCode: qrBase64,
        status: connectionStatus,
        timestamp: new Date().toISOString(),
        instructions: 'Escanea este código QR con WhatsApp para conectar'
    });
});

// Endpoint para obtener el estado de conexión
app.get('/status', (req, res) => {
    res.json({
      success: true,
      status: connectionStatus,
      connected: isConnected,
      hasQR: !!currentQR,
      timestamp: new Date().toISOString(),
    });
});

// Endpoint para forzar reconexión
app.post('/reconnect', async (req, res) => {
    try {
        console.log('🔄 Iniciando proceso de reconexión...');
        
        if (isConnected) {
            console.log('⚠️ WhatsApp ya está conectado, reiniciando...');
        }

        // Destruir cliente actual y crear uno nuevo
        await client.destroy();
        
        // Resetear variables
        currentQR = null;
        qrBase64 = null;
        isConnected = false;
        connectionStatus = 'reconnecting';
        
        // Reinicializar
        setTimeout(() => {
            client.initialize();
        }, 2000);

        res.json({
            success: true,
            message: 'Proceso de reconexión iniciado',
            status: 'reconnecting',
            timestamp: new Date().toISOString(),
            note: 'Usa /qr para obtener el nuevo código QR en unos segundos'
        });

    } catch (error) {
        console.error('❌ Error durante reconexión:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error durante el proceso de reconexión',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Solo escuchar en localhost
app.listen(3001, 'localhost', () => {
    console.log('API segura escuchando SOLO en localhost:3001');
    console.log('🛡️ Configuración de seguridad activada');
});
