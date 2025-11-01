// server.js - VERSIÓN FINAL BASADA EN EL DIAGNÓSTICO
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

console.log('🚀 Iniciando servidor TuAmigoFielLocal...');

// CORS configurado para producción
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:4000', 
    'https://remarkable-cajeta-23ef55.netlify.app',
    'https://backend-tuamigofiel.onrender.com',
    'https://timely-churros-9d5736.netlify.app'
  ],
  credentials: true
}));

app.use(express.json());

// Rutas básicas
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 Servidor TuAmigoFielLocal funcionando', 
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Montar rutas (ESTA ESTRUCTURA FUNCIONA)
const routes = [
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

console.log('📁 Montando rutas...');
routes.forEach(route => {
  const router = require(route.module);
  app.use(route.path, router.default || router);
  console.log(`✅ ${route.path}`);
});

// Inicialización básica
async function startServer() {
  try {
    // MongoDB
    try {
      const mongo = require('./config/mongo');
      if (mongo.connectMongo) {
        await mongo.connectMongo();
        console.log('✅ MongoDB conectado');
      }
    } catch (e) {
      console.log('ℹ️  MongoDB no disponible');
    }

    app.listen(PORT, () => {
      console.log(`\n🎉 Servidor ejecutándose en http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('💥 Error:', error);
    process.exit(1);
  }
}

startServer();