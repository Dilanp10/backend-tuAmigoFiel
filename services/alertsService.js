// src/services/alertsService.js
// Este service incluye la definición del modelo Alert internamente para evitar tocar más ficheros.
const { connectMongo, mongoose } = require('./config/mongo'); // ajusta ruta si es necesario
const productService = require('./productosService'); // tu service existente
const nodemailer = require('nodemailer');

const LOW_STOCK_THRESHOLD = parseInt(process.env.ALERT_LOW_STOCK_THRESHOLD || '5', 10);
const EXPIRY_DAYS = parseInt(process.env.ALERT_EXPIRY_DAYS || '30', 10);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || null;

// --- Definición del esquema/modelo inline ---
const { Schema } = mongoose;

const AlertSchema = new Schema({
  productRef: { type: Schema.Types.ObjectId, ref: 'Producto', default: null },
  oldProductId: { type: Schema.Types.Mixed, default: null }, // para preservar id numérico de sqlite
  type: { type: String, enum: ['stock', 'expiry'], required: true },
  message: { type: String, required: true },
  meta: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null },
});

// transformar la salida para devolver `id` en vez de `_id`
AlertSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

let Alert; // se inicializa tras conectar

// --- Email helper (opcional) ---
const sendEmail = async (subject, text) => {
  if (!process.env.SMTP_HOST || !ADMIN_EMAIL) {
    console.log('[alertsService] SMTP o ADMIN_EMAIL no configurado — no se envía email.');
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      } : undefined,
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || `TuAmigoFiel <no-reply@tuamigofiel.local>`,
      to: ADMIN_EMAIL,
      subject,
      text,
    });
    console.log('[alertsService] Email enviado a', ADMIN_EMAIL);
  } catch (err) {
    console.error('[alertsService] Error enviando email', err);
  }
};

// --- Inicializador: conectar a Mongo y crear modelo/índices ---
const init = async () => {
  await connectMongo();
  if (!Alert) {
    Alert = mongoose.models.Alert || mongoose.model('Alert', AlertSchema);
  }

  // Crear índices parciales para evitar duplicados abiertos
  try {
    await Alert.collection.createIndex(
      { productRef: 1, type: 1 },
      {
        unique: true,
        partialFilterExpression: { resolvedAt: { $type: 'null' }, productRef: { $exists: true } },
        name: 'uniq_open_alert_per_productref_type',
      }
    );
    await Alert.collection.createIndex(
      { oldProductId: 1, type: 1 },
      {
        unique: true,
        partialFilterExpression: { resolvedAt: { $type: 'null' }, oldProductId: { $exists: true } },
        name: 'uniq_open_alert_per_oldProductId_type',
      }
    );
    console.log('[alertsService] índices creados/verificados');
  } catch (err) {
    console.warn('[alertsService] fallo creando índices (puede que ya existan):', err.message);
  }
};

// createAlertIfNotExists: evita duplicados abiertos
const createAlertIfNotExists = async ({ productRef = null, oldProductId = null, type, message, meta = {} }) => {
  if (!Alert) await init();

  const query = { type, resolvedAt: null };
  if (productRef) {
    try { query.productRef = mongoose.Types.ObjectId(productRef); } catch(e) { query.productRef = productRef; }
  } else if (oldProductId != null) {
    query.oldProductId = oldProductId;
  } else {
    query.productRef = null;
  }

  const existing = await Alert.findOne(query).lean();
  if (existing) return existing;

  const doc = await Alert.create({
    productRef: productRef ? (mongoose.Types.ObjectId.isValid(productRef) ? mongoose.Types.ObjectId(productRef) : null) : null,
    oldProductId: oldProductId != null ? oldProductId : null,
    type,
    message,
    meta: meta || {},
  });

  const subject = `ALERTA: ${type === 'stock' ? 'Stock bajo' : 'Vencimiento próximo'}`;
  const body = `${message}\n\nProductoRef: ${productRef || 'N/A'}\nOldProductId: ${oldProductId || 'N/A'}\nMeta: ${JSON.stringify(meta || {})}`;
  sendEmail(subject, body).catch(() => {});

  return doc.toJSON();
};

// checkAndCreateAlerts: revisa productos y crea alertas
const checkAndCreateAlerts = async () => {
  if (!Alert) await init();

  // obtener todos los productos vía productService (tu implementación existente)
  const products = (await productService.listarProductos?.()) || [];

  const now = new Date();
  const expiryCutoff = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const created = [];

  for (const p of products) {
    // normalizar id del producto (puede venir de sqlite: p.id (num) o de mongo: p._id)
    const isMongoId = p && (p._id || (p.id && String(p.id).match(/^[0-9a-fA-F]{24}$/)));
    const productRef = p._id ? String(p._id) : (isMongoId && p.id ? String(p.id) : null);
    const oldProductId = (p.id && !productRef) ? p.id : (p.product_id ?? null);

    // stock low
    const stock = (p.stock == null) ? null : Number(p.stock);
    if (stock != null && stock <= LOW_STOCK_THRESHOLD) {
      const message = `Stock bajo: ${p.nombre || p.name || 'Sin nombre'} — quedan ${stock} unidades (umbral ${LOW_STOCK_THRESHOLD}).`;
      const alert = await createAlertIfNotExists({ productRef, oldProductId, type: 'stock', message, meta: { stock, threshold: LOW_STOCK_THRESHOLD } });
      created.push(alert);
    }

    // expiry check
    const vencStr = p.vencimiento || p.fecha_vencimiento || p.expiry || p.expiry_date || null;
    if (vencStr) {
      const d = new Date(String(vencStr).trim());
      if (!isNaN(d.getTime())) {
        if (d <= expiryCutoff) {
          const daysLeft = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
          const message = daysLeft < 0
            ? `Producto vencido: ${p.nombre || p.name} — venció hace ${Math.abs(daysLeft)} días (vto: ${d.toISOString().slice(0,10)}).`
            : `Producto por vencer: ${p.nombre || p.name} — queda(n) ${daysLeft} día(s) (vto: ${d.toISOString().slice(0,10)}).`;
          const alert = await createAlertIfNotExists({ productRef, oldProductId, type: 'expiry', message, meta: { vencimiento: d.toISOString().slice(0,10), daysLeft } });
          created.push(alert);
        }
      }
    }
  }

  return created;
};

// listar alertas
const listAlerts = async ({ onlyUnresolved = true } = {}) => {
  if (!Alert) await init();
  const q = onlyUnresolved ? { resolvedAt: null } : {};
  const docs = await Alert.find(q).sort({ createdAt: -1 }).lean();
  return docs.map(d => {
    if (d._id && !d.id) {
      d.id = String(d._id);
      delete d._id;
      delete d.__v;
    }
    return d;
  });
};

// resolver alerta
const resolveAlert = async (id) => {
  if (!Alert) await init();
  const isObjectId = mongoose.Types.ObjectId.isValid(id);
  const filter = isObjectId ? { _id: mongoose.Types.ObjectId(id) } : { _id: id };
  await Alert.updateOne(filter, { $set: { resolvedAt: new Date() } });
  const doc = await Alert.findOne(filter).lean();
  if (!doc) return null;
  if (doc._id && !doc.id) {
    doc.id = String(doc._id);
    delete doc._id;
    delete doc.__v;
  }
  return doc;
};

module.exports = {
  init, // inicializar desde app.js si querés
  checkAndCreateAlerts,
  listAlerts,
  resolveAlert,
  createAlertIfNotExists,
};