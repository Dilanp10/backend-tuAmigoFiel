// backend/services/authService.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { connectMongo, mongoose } = require('../config/mongo');

const ENV_ADMIN_USER = process.env.ADMIN_USER || null;
const ENV_ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || null; // si ya tenés hash en .env
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '1d';

const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'user' }, // 'admin' | 'user'
  email: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// actualización automática de updatedAt
UserSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// no devolver passwordHash en JSON
UserSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  },
});

let User; // modelo inicializado en init()

// Inicializa conexión y modelo (puedes llamar esto desde server.js si quieres)
const init = async () => {
  await connectMongo();
  if (!User) {
    User = mongoose.models.User || mongoose.model('User', UserSchema);
    try {
      await User.createIndexes(); // asegura índices
    } catch (e) {
      // no fatal si ya existen
    }
  }

  // Si existe ADMIN en env y no existe en DB, crear usuario admin (preserva el hash en ENV)
  if (ENV_ADMIN_USER && ENV_ADMIN_PASS_HASH) {
    try {
      const found = await User.findOne({ username: ENV_ADMIN_USER }).lean().exec();
      if (!found) {
        await User.create({
          username: ENV_ADMIN_USER,
          passwordHash: ENV_ADMIN_PASS_HASH,
          role: 'admin',
        });
        console.log('[authService] Usuario admin creado desde ENV en Mongo.');
      }
    } catch (err) {
      console.warn('[authService] No se pudo crear admin desde ENV:', err.message);
    }
  }
};

// loginService: intenta con Mongo (si está disponible), y si falla usa fallback a ENV admin
const loginService = async (username, pass) => {
  // asegurarse de inicializar modelo/conexión (si no se llamó init desde server)
  try {
    if (!User) await init();
  } catch (err) {
    console.warn('[authService] init falló (seguiré intentando fallback):', err.message);
  }

  // 1) Intentar login con Mongo
  try {
    if (User) {
      const dbUser = await User.findOne({ username }).exec();
      if (dbUser) {
        const match = await bcrypt.compare(pass, dbUser.passwordHash);
        if (!match) {
          console.log('❌ CONTRASEÑA INCORRECTA (Mongo)');
          return null;
        }
        const payload = { user: dbUser.username, role: dbUser.role, uid: String(dbUser._id) };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
        console.log('✅ LOGIN EXITOSO (Mongo)');
        return token;
      }
    }
  } catch (err) {
    console.warn('[authService] Error consultando usuario en Mongo, cae a fallback ENV:', err.message);
    // sigue al fallback
  }

  // 2) Fallback a ADMIN en variables de entorno
  if (ENV_ADMIN_USER && ENV_ADMIN_PASS_HASH) {
    if (username !== ENV_ADMIN_USER) {
      console.log('❌ USUARIO INCORRECTO (ENV fallback)');
      return null;
    }
    try {
      const match = await bcrypt.compare(pass, ENV_ADMIN_PASS_HASH);
      if (!match) {
        console.log('❌ CONTRASEÑA INCORRECTA (ENV fallback)');
        return null;
      }
      const payload = { user: ENV_ADMIN_USER, role: 'admin', uid: 'env-admin' };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
      console.log('✅ LOGIN EXITOSO (ENV fallback)');
      return token;
    } catch (err) {
      console.warn('[authService] Error comparando contraseña ENV:', err.message);
      return null;
    }
  }

  // 3) Si no hay Mongo ni ENV admin válido -> no autenticamos
  console.warn('[authService] No hay método de autenticación disponible (Mongo y ENV admin fallaron).');
  return null;
};

module.exports = {
  init,
  loginService,
};