// server.js - versión reforzada con logging y validación de mounts
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

// --------------------------------------------------------
// CORS: permitir subdominios netlify.app y localhost
// --------------------------------------------------------
const allowedOrigins = [
  'http://localhost:4000',
  'http://localhost:3000',
];

const isNetlifyOrigin = (origin) => {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return /\.netlify\.app$/.test(hostname);
  } catch (e) {
    return false;
  }
};

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || isNetlifyOrigin(origin)) {
      return callback(null, true);
    }
    console.warn('[CORS] Origen bloqueado:', origin);
    return callback(new Error('Acceso no permitido por CORS'));
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  preflightContinue: false,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// healthcheck
app.get('/', (req, res) => res.send('API backend funcionando'));

// --------------------------------------------------------
// Funciones auxiliares para require y montaje seguro
// --------------------------------------------------------
function safeRequire(modulePath) {
  try {
    const resolved = require.resolve(modulePath);
    const mod = require(modulePath);
    console.log(`[SAFE_REQUIRE] OK -> ${modulePath} (resolved: ${resolved})`);
    return mod;
  } catch (err) {
    console.error(`[SAFE_REQUIRE] ERROR al require '${modulePath}':`, err && (err.stack || err.message));
    return null;
  }
}

function isLikelyExpressRouter(obj) {
  // Un Router en Express tiene .stack (array) y .use / .handle funcs en general
  return obj && (typeof obj === 'function' || (Array.isArray(obj.stack) && obj.handle));
}

/**
 * Monta una ruta de forma segura y loggea información útil.
 * Si el "routerModule" no es un router válido, no lo monta.
 */
function safeMount(mountPath, modulePath) {
  try {
    const mod = safeRequire(modulePath);
    if (!mod) {
      console.warn(`[SAFE_MOUNT] Módulo no cargado: ${modulePath}, saltando mount ${mountPath}`);
      return;
    }

    // Si el módulo exporta un objeto con .default (es build ESM transpilado)
    const candidate = mod.default || mod;

    if (!isLikelyExpressRouter(candidate)) {
      console.warn(`[SAFE_MOUNT] El módulo '${modulePath}' no parece un Router/middleware de Express. Tipo: ${typeof candidate}`);
      // mostrar keys para depuración
      if (candidate && typeof candidate === 'object') {
        console.warn('[SAFE_MOUNT] keys del export:', Object.keys(candidate));
      }
      // No montamos para evitar que app.use intente parsear algo inválido.
      return;
    }

    // Finalmente montar con try/catch
    try {
      app.use(mountPath, candidate);
      console.log(`[SAFE_MOUNT] Montado: '${mountPath}' -> ${modulePath}`);
    } catch (err) {
      console.error(`[SAFE_MOUNT] ERROR montando '${mountPath}' con '${modulePath}':`, err && (err.stack || err.message));
    }
  } catch (err) {
    console.error(`[SAFE_MOUNT] ERROR inesperado para '${modulePath}':`, err && (err.stack || err.message));
  }
}

// --------------------------------------------------------
// Montar rutas de forma segura
// --------------------------------------------------------
// Lista de mounts (path -> module)
const mounts = [
  { path: '/api', module: './routes/auth' },
  { path: '/api/products', module: './routes/productos' },
  { path: '/api/sales', module: './routes/sales' },
  { path: '/api/services', module: './routes/services' },
  { path: '/api/alerts', module: './routes/alerts' },
  { path: '/api/reports', module: './routes/reports' },
  { path: '/api/customers', module: './routes/customers' },
  { path: '/api/payments', module: './routes/payments' },
  // si tenés otro router para customer sales con distinto path, listalo separado; 
  // NO repitas exactamente el mismo path con otro require sin asegurarte del router
  { path: '/api/customers/sales', module: './routes/customerSales' }
];

mounts.forEach(m => safeMount(m.path, m.module));

// --------------------------------------------------------
// Inicializaciones (servicios) en bloques try/catch
// --------------------------------------------------------
(async function initApp() {
  try {
    // Conexión a Mongo y otros inits: cada uno en su try/catch para no romper todo
    try {
      const { connectMongo } = safeRequire('./config/mongo') || {};
      if (connectMongo) {
        await connectMongo();
        console.log('[INIT] connectMongo OK');
      } else {
        console.warn('[INIT] connectMongo no encontrado o failed require');
      }
    } catch (err) {
      console.warn('[INIT] Error conectando a Mongo:', err && err.message);
    }

    // Inicializar servicios de forma segura (ejemplo salesService, alertsService, etc)
    const servicesToInit = [
      './services/salesService',
      './services/alertsService',
      './services/productosService',
      './services/customersService',
      './services/servicesService',
      './services/reportsService' // incluyo reportsService también
    ];

    for (const sPath of servicesToInit) {
      try {
        const svc = safeRequire(sPath);
        if (svc && typeof svc.init === 'function') {
          await svc.init();
          console.log(`[INIT] Servicio inicializado: ${sPath}`);
        } else {
          console.log(`[INIT] Servicio sin init (skip): ${sPath}`);
        }
      } catch (err) {
        console.warn(`[INIT] Error inicializando servicio ${sPath}:`, err && err.message);
      }
    }

    // Route temporal para debug
    app.get('/api/alerts/generate', async (req, res) => {
      try {
        const alertsService = safeRequire('./services/alertsService');
        if (!alertsService || typeof alertsService.checkAndCreateAlerts !== 'function') {
          return res.status(500).json({ success: false, message: 'alertsService no disponible' });
        }
        const created = await alertsService.checkAndCreateAlerts();
        return res.json({ success: true, message: `Generadas ${created.length} alertas`, alerts: created });
      } catch (err) {
        console.error('DEBUG generate alerts error:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    });

    // Levantar servidor
    const server = app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT} (PORT env: ${process.env.PORT})`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('Cerrando servidor...');
      server.close(() => console.log('HTTP server cerrado'));
      try {
        const { mongoose } = require('./config/mongo');
        if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
          await mongoose.disconnect();
          console.log('Mongo desconectado');
        }
      } catch (e) {}
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    console.error('[server] Error inicializando app (fatal):', err && (err.stack || err.message));
    process.exit(1);
  }
})();