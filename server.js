// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Rutas (ajusta si algún archivo está en otra carpeta)
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

// Healthcheck (se deja disponible antes del init para response simple)
app.get('/', (req, res) => res.send('API backend funcionando'));

// Async init: conectar a Mongo, inicializar services y jobs, luego montar rutas y arrancar server
(async function initApp() {
  try {
    // 1) Conectar a Mongo (archivo: src/config/mongo.js)
    try {
      const { connectMongo } = require('./config/mongo');
      await connectMongo();
      console.log('[server] Conexión a Mongo OK');
    } catch (err) {
      console.warn('[server] No se pudo conectar a Mongo (si no lo tenés configurado está bien por ahora):', err.message);
      // Si quieres obligar a que Mongo esté presente, lanza el error aquí:
      // throw err;
    }

    // 2) Inicializar servicios que requieran setup (índices, modelos)
    try {
      const alertsService = require('./src/services/alertsService');
      if (alertsService && typeof alertsService.init === 'function') {
        await alertsService.init();
        console.log('[server] alertsService inicializado');
      }
    } catch (err) {
      console.warn('[server] No se pudo inicializar alertsService (revisá src/services/alertsService):', err.message);
    }

    // AGREGAR INICIALIZACIÓN DE PRODUCTOS SERVICE
    try {
      const productosService = require('./src/services/productosService');
      if (productosService && typeof productosService.init === 'function') {
        await productosService.init();
        console.log('[server] productosService inicializado');
      }
    } catch (err) {
      console.warn('[server] No se pudo inicializar productosService:', err.message);
    }

    // AGREGAR INICIALIZACIÓN DE CUSTOMERS SERVICE
    try {
      const customersService = require('./src/services/customersService');
      if (customersService && typeof customersService.init === 'function') {
        await customersService.init();
        console.log('[server] customersService inicializado');
      }
    } catch (err) {
      console.warn('[server] No se pudo inicializar customersService:', err.message);
    }

    // AGREGAR INICIALIZACIÓN DE SERVICES SERVICE
    try {
      const servicesService = require('./src/services/servicesService');
      if (servicesService && typeof servicesService.init === 'function') {
        await servicesService.init();
        console.log('[server] servicesService inicializado');
      }
    } catch (err) {
      console.warn('[server] No se pudo inicializar servicesService:', err.message);
    }

    // 3) Montar rutas (después de init para que controllers puedan usar servicios inicializados)
    app.use('/api', authRoutes);        // /api/login
    app.use('/api/products', productosRoutes); // /api/products
    app.use('/api/sales', salesRoutes); // /api/sales
    app.use('/api/services', servicesRoutes); // /api/services
    app.use('/api/alerts', alertsRoutes); // alerts
    app.use('/api/reports', reportsRoutes);
    app.use('/api/customers', customersRoutes);
    app.use('/api/payments', paymentsRoutes);
    app.use('/api/customers', customerSalesRoutes);

    // 4) Levantar server
    const server = app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    });

    // 5) Arrancar job de alertas si existe
    try {
      const { start: startAlertsJob } = require('./src/jobs/alertsJob');
      if (typeof startAlertsJob === 'function') {
        startAlertsJob();
        console.log('[server] alertsJob arrancado');
      } else {
        console.warn('[server] start function not found in ./src/jobs/alertsJob');
      }
    } catch (err) {
      console.error('[server] No se pudo arrancar alertsJob:', err.message);
    }

    // Graceful shutdown (opcional pero recomendado)
    const shutdown = async () => {
      console.log('Cerrando servidor...');
      server.close(() => console.log('HTTP server cerrado'));
      // cerrar Mongo si está conectada
      try {
        const { mongoose } = require('./config/mongo');
        if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
          await mongoose.disconnect();
          console.log('Mongo desconectado');
        }
      } catch (e) {
        /* ignore */
      }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    console.error('[server] Error inicializando app:', err);
    process.exit(1);
  }
})();