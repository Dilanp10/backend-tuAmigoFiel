// server.js - VERSIÓN CORREGIDA PARA ESTRUCTURA EN RAÍZ
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Rutas (EN RAÍZ - sin src/)
const authRoutes = require('./routes/auth');
const productosRoutes = require('./routes/productos');
const salesRoutes = require('./routes/sales');
const servicesRoutes = require('./routes/services');
const alertsRoutes = require('./routes/alerts');
const reportsRoutes = require('./routes/reports');
const customersRoutes = require('./routes/customers');
const paymentsRoutes = require('./routes/payments');
const customerSalesRoutes = require('./routes/customerSales');

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors());
app.use(express.json());

// Healthcheck
app.get('/', (req, res) => res.send('API backend funcionando'));

// Async init
(async function initApp() {
  try {
    // 1) Conectar a Mongo (EN RAÍZ)
    try {
      const { connectMongo } = require('./config/mongo'); // ← SIN src/
      await connectMongo();
      console.log('[server] Conexión a Mongo OK');
    } catch (err) {
      console.warn('[server] No se pudo conectar a Mongo:', err.message);
    }

    // 2) Inicializar servicios (EN RAÍZ)
    try {
      const alertsService = require('./services/alertsService'); // ← SIN src/
      if (alertsService && typeof alertsService.init === 'function') {
        await alertsService.init();
        console.log('[server] alertsService inicializado');
      }
    } catch (err) {
      console.warn('[server] No se pudo inicializar alertsService:', err.message);
    }

    try {
      const productosService = require('./services/productosService'); // ← SIN src/
      if (productosService && typeof productosService.init === 'function') {
        await productosService.init();
        console.log('[server] productosService inicializado');
      }
    } catch (err) {
      console.warn('[server] No se pudo inicializar productosService:', err.message);
    }

    try {
      const customersService = require('./services/customersService'); // ← SIN src/
      if (customersService && typeof customersService.init === 'function') {
        await customersService.init();
        console.log('[server] customersService inicializado');
      }
    } catch (err) {
      console.warn('[server] No se pudo inicializar customersService:', err.message);
    }

    try {
      const servicesService = require('./services/servicesService'); // ← SIN src/
      if (servicesService && typeof servicesService.init === 'function') {
        await servicesService.init();
        console.log('[server] servicesService inicializado');
      }
    } catch (err) {
      console.warn('[server] No se pudo inicializar servicesService:', err.message);
    }

    // Ruta manual para generar alertas (TEMPORAL)
    app.get('/api/alerts/generate', async (req, res) => {
      try {
        const alertsService = require('./services/alertsService'); // ← SIN src/
        console.log('[DEBUG] Generando alertas manualmente...');
        const created = await alertsService.checkAndCreateAlerts();
        res.json({ 
          success: true, 
          message: `Generadas ${created.length} alertas`,
          alerts: created 
        });
      } catch (err) {
        console.error('[DEBUG] Error generando alertas:', err);
        res.status(500).json({ 
          success: false, 
          error: err.message 
        });
      }
    });

    // 3) Montar rutas
    app.use('/api', authRoutes);
    app.use('/api/products', productosRoutes);
    app.use('/api/sales', salesRoutes);
    app.use('/api/services', servicesRoutes);
    app.use('/api/alerts', alertsRoutes);
    app.use('/api/reports', reportsRoutes);
    app.use('/api/customers', customersRoutes);
    app.use('/api/payments', paymentsRoutes);
    app.use('/api/customers', customerSalesRoutes);

    // 4) Levantar server
    const server = app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    });

    // 5) Arrancar job de alertas (EN RAÍZ)
    try {
      const { start: startAlertsJob } = require('./jobs/alertsJob'); // ← SIN src/
      if (typeof startAlertsJob === 'function') {
        startAlertsJob();
        console.log('[server] alertsJob arrancado');
      }
    } catch (err) {
      console.error('[server] No se pudo arrancar alertsJob:', err.message);
    }

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
    console.error('[server] Error inicializando app:', err);
    process.exit(1);
  }
})();