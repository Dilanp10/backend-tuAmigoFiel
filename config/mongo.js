// backend/config/mongo.js
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tuamigohosting';

const connectMongo = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  try {
    await mongoose.connect(MONGO_URI);
    console.log('[mongo] Conectado a MongoDB');
    return mongoose.connection;
  } catch (err) {
    console.error('[mongo] Error conectando a MongoDB:', err.message);
    throw err;
  }
};

module.exports = { connectMongo, mongoose };