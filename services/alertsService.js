// services/alertsService.js - VERSIÓN CORREGIDA
const { connectMongo, mongoose } = require('../config/mongo');
const productService = require('./productosService');

const LOW_STOCK_THRESHOLD = parseInt(process.env.ALERT_LOW_STOCK_THRESHOLD || '5', 10);
const EXPIRY_DAYS = parseInt(process.env.ALERT_EXPIRY_DAYS || '30', 10);

const { Schema } = mongoose;

const AlertSchema = new Schema({
  productRef: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  oldProductId: { type: Schema.Types.Mixed, default: null },
  type: { type: String, enum: ['stock', 'expiry'], required: true },
  message: { type: String, required: true },
  meta: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null },
});

AlertSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

let Alert;

const init = async () => {
  await connectMongo();
  Alert = mongoose.models.Alert || mongoose.model('Alert', AlertSchema);
  console.log('[alertsService] Alert model inicializado');
};

const createAlertIfNotExists = async ({ productRef = null, oldProductId = null, type, message, meta = {} }) => {
  if (!Alert) await init();

  const query = { type, resolvedAt: null };
  if (productRef) {
    try { 
      query.productRef = new mongoose.Types.ObjectId(productRef); // ✅ CORREGIDO
    } catch(e) { 
      query.productRef = productRef; 
    }
  } else if (oldProductId != null) {
    query.oldProductId = oldProductId;
  } else {
    query.productRef = null;
  }

  const existing = await Alert.findOne(query).lean();
  if (existing) return existing;

  const doc = await Alert.create({
    productRef: productRef ? (mongoose.Types.ObjectId.isValid(productRef) ? new mongoose.Types.ObjectId(productRef) : null) : null, // ✅ CORREGIDO
    oldProductId: oldProductId != null ? oldProductId : null,
    type,
    message,
    meta: meta || {},
  });

  return doc.toJSON();
};

const checkAndCreateAlerts = async () => {
  if (!Alert) await init();

  const products = (await productService.listarProductos?.()) || [];
  const now = new Date();
  const expiryCutoff = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const created = [];

  for (const p of products) {
    const isMongoId = p && (p._id || (p.id && String(p.id).match(/^[0-9a-fA-F]{24}$/)));
    const productRef = p._id ? String(p._id) : (isMongoId && p.id ? String(p.id) : null);
    const oldProductId = (p.id && !productRef) ? p.id : (p.product_id ?? null);

    // Stock bajo
    const stock = (p.stock == null) ? null : Number(p.stock);
    if (stock != null && stock <= LOW_STOCK_THRESHOLD) {
      const message = `Stock bajo: ${p.nombre || 'Sin nombre'} — quedan ${stock} unidades.`;
      const alert = await createAlertIfNotExists({ 
        productRef, 
        oldProductId, 
        type: 'stock', 
        message, 
        meta: { stock, threshold: LOW_STOCK_THRESHOLD } 
      });
      created.push(alert);
    }

    // Vencimiento
    const vencStr = p.vencimiento;
    if (vencStr) {
      const d = new Date(String(vencStr).trim());
      if (!isNaN(d.getTime())) {
        if (d <= expiryCutoff) {
          const daysLeft = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
          const message = daysLeft < 0
            ? `Producto vencido: ${p.nombre} — venció hace ${Math.abs(daysLeft)} días.`
            : `Producto por vencer: ${p.nombre} — queda(n) ${daysLeft} día(s).`;
          const alert = await createAlertIfNotExists({ 
            productRef, 
            oldProductId, 
            type: 'expiry', 
            message, 
            meta: { vencimiento: d.toISOString().slice(0,10), daysLeft } 
          });
          created.push(alert);
        }
      }
    }
  }

  console.log(`[alertsService] ${created.length} alertas generadas`);
  return created;
};

const listAlerts = async ({ onlyUnresolved = true } = {}) => {
  if (!Alert) await init();
  const q = onlyUnresolved ? { resolvedAt: null } : {};
  const docs = await Alert.find(q).sort({ createdAt: -1 }).lean();
  return docs.map(d => {
    d.id = String(d._id);
    delete d._id;
    delete d.__v;
    return d;
  });
};

const resolveAlert = async (id) => {
  if (!Alert) await init();
  const isObjectId = mongoose.Types.ObjectId.isValid(id);
  const filter = isObjectId ? { _id: new mongoose.Types.ObjectId(id) } : { _id: id }; // ✅ CORREGIDO
  await Alert.updateOne(filter, { $set: { resolvedAt: new Date() } });
  const doc = await Alert.findOne(filter).lean();
  if (!doc) return null;
  doc.id = String(doc._id);
  delete doc._id;
  delete doc.__v;
  return doc;
};

module.exports = {
  init,
  checkAndCreateAlerts,
  listAlerts,
  resolveAlert,
  createAlertIfNotExists,
};