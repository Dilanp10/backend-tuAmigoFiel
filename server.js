// server.js - VERSIÓN COMPLETA Y FUNCIONAL
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

/* ----------------------------- CONFIGURACIÓN BÁSICA ----------------------------- */
console.log('🔍 Iniciando servidor en modo diagnóstico...');

// Middleware básico
app.use(express.json());

// CORS simplificado
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:4000'],
  credentials: true
}));

/* ----------------------------- RUTAS DE DIAGNÓSTICO ----------------------------- */
// Ruta raíz - siempre funciona
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 Servidor TuAmigoFielLocal funcionando', 
    status: 'OK',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    database: 'checking...',
    timestamp: new Date().toISOString()
  });
});

// Ruta de prueba de API
app.get('/api/test', (req, res) => {
  res.json({ 
    message: '✅ API funcionando correctamente',
    endpoints: {
      auth: '/api/login',
      products: '/api/products',
      sales: '/api/sales',
      customers: '/api/customers'
    }
  });
});

/* ----------------------------- FUNCIÓN SEGURA PARA MONTAR RUTAS ----------------------------- */
function safeMountRoute(routePath, routeModule) {
  try {
    console.log(`🔄 Intentando cargar: ${routeModule}`);
    
    // Verificar si el archivo existe
    try {
      require.resolve(routeModule);
    } catch (err) {
      console.log(`❌ Archivo no encontrado: ${routeModule}`);
      return false;
    }

    // Cargar el módulo
    const module = require(routeModule);
    const router = module.default || module;
    
    // Verificar que sea un router de Express
    if (typeof router !== 'function' && !router.stack) {
      console.log(`❌ ${routeModule} no es un router válido`);
      return false;
    }

    // Montar la ruta
    app.use(routePath, router);
    console.log(`✅ Ruta montada: ${routePath} -> ${routeModule}`);
    return true;
    
  } catch (error) {
    console.log(`❌ Error cargando ${routeModule}:`, error.message);
    return false;
  }
}

/* ----------------------------- MONTAR RUTAS UNA POR UNA ----------------------------- */
console.log('\n📁 Montando rutas...');

// Lista de rutas a montar (en orden de prioridad)
const routesToMount = [
  { path: '/api', module: './routes/auth' },
  { path: '/api/products', module: './routes/productos' },
  { path: '/api/sales', module: './routes/sales' },
  { path: '/api/services', module: './routes/services' },
  { path: '/api/alerts', module: './routes/alerts' },
  { path: '/api/reports', module: './routes/reports' },
  { path: '/api/customers', module: './routes/customers' },
  { path: '/api/payments', module: './routes/payments' },
  { path: '/api/customers/sales', module: './routes/customerSales' }
];

// Montar rutas de forma segura
let mountedCount = 0;
routesToMount.forEach(route => {
  if (safeMountRoute(route.path, route.module)) {
    mountedCount++;
  }
});

console.log(`\n📊 Resumen: ${mountedCount}/${routesToMount.length} rutas montadas correctamente`);

/* ----------------------------- CONEXIÓN A BASE DE DATOS ----------------------------- */
async function initializeDatabase() {
  try {
    console.log('\n🗄️  Inicializando base de datos...');
    
    // Intentar conectar a MongoDB si existe
    try {
      const mongo = require('./config/mongo');
      if (mongo && typeof mongo.connectMongo === 'function') {
        await mongo.connectMongo();
        console.log('✅ MongoDB conectado exitosamente');
      }
    } catch (mongoError) {
      console.log('ℹ️  MongoDB no configurado o error de conexión:', mongoError.message);
    }

    // Intentar conectar a SQLite si existe
    try {
      const sqlite = require('./config/database');
      if (sqlite && typeof sqlite.init === 'function') {
        await sqlite.init();
        console.log('✅ SQLite inicializado exitosamente');
      }
    } catch (sqliteError) {
      console.log('ℹ️  SQLite no configurado o error de conexión:', sqliteError.message);
    }
    
  } catch (error) {
    console.log('⚠️  Advertencia en inicialización de BD:', error.message);
  }
}

/* ----------------------------- INICIALIZACIÓN DE SERVICIOS ----------------------------- */
async function initializeServices() {
  try {
    console.log('\n🔧 Inicializando servicios...');
    
    const services = [
      './services/salesService',
      './services/alertsService',
      './services/productosService',
      './services/customersService',
      './services/servicesService',
      './services/reportsService'
    ];

    let initializedCount = 0;
    
    for (const servicePath of services) {
      try {
        // Verificar si el servicio existe
        require.resolve(servicePath);
        const service = require(servicePath);
        
        if (service && typeof service.init === 'function') {
          await service.init();
          console.log(`✅ ${servicePath} inicializado`);
          initializedCount++;
        }
      } catch (serviceError) {
        console.log(`ℹ️  ${servicePath} no disponible:`, serviceError.message);
      }
    }
    
    console.log(`📊 ${initializedCount} servicios inicializados`);
    
  } catch (error) {
    console.log('⚠️  Advertencia en inicialización de servicios:', error.message);
  }
}

/* ----------------------------- INICIALIZACIÓN PRINCIPAL ----------------------------- */
async function initializeApp() {
  try {
    console.log('\n🎯 Inicializando aplicación...');
    
    // 1. Primero la base de datos
    await initializeDatabase();
    
    // 2. Luego los servicios
    await initializeServices();
    
    // 3. Finalmente arrancar el servidor
    const server = app.listen(PORT, () => {
      console.log('\n✨ ========================================');
      console.log(`✨ 🚀 Servidor ejecutándose en http://localhost:${PORT}`);
      console.log(`✨ 📊 Health: http://localhost:${PORT}/health`);
      console.log(`✨ 🔍 API Test: http://localhost:${PORT}/api/test`);
      console.log('✨ ========================================\n');
      
      // Mostrar rutas disponibles
      console.log('📍 Endpoints disponibles:');
      console.log('   📍 GET  /              - Página de inicio');
      console.log('   📍 GET  /health        - Health check');
      console.log('   📍 GET  /api/test      - Test de API');
      console.log('   📍 POST /api/login     - Autenticación');
      console.log('   📍 GET  /api/products  - Productos');
      console.log('   📍 GET  /api/sales     - Ventas');
      console.log('   📍 GET  /api/customers - Clientes');
      console.log('   📍 ... y más endpoints montados\n');
    });

    /* ----------------------------- GRACEFUL SHUTDOWN ----------------------------- */
    const gracefulShutdown = async (signal) => {
      console.log(`\n⚠️  Recibido ${signal}. Cerrando servidor...`);
      
      server.close(() => {
        console.log('✅ Servidor HTTP cerrado');
        
        // Cerrar conexiones de base de datos
        try {
          const { mongoose } = require('./config/mongo');
          if (mongoose && mongoose.connection.readyState === 1) {
            mongoose.connection.close();
            console.log('✅ Conexión MongoDB cerrada');
          }
        } catch (e) {}
        
        console.log('👋 Servidor cerrado exitosamente');
        process.exit(0);
      });

      // Timeout forzado después de 10 segundos
      setTimeout(() => {
        console.error('❌ Timeout forzando cierre del servidor');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
  } catch (error) {
    console.error('❌ Error crítico inicializando la aplicación:', error);
    process.exit(1);
  }
}

/* ----------------------------- MANEJO DE ERRORES GLOBALES ----------------------------- */
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

/* ----------------------------- INICIAR APLICACIÓN ----------------------------- */
// Iniciar todo el proceso
initializeApp().catch(error => {
  console.error('💥 Error fatal al iniciar aplicación:', error);
  process.exit(1);
});

module.exports = app;