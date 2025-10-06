// services/alertsService.js - VERSIÓN MEJORADA
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

  // Índices más permisivos para evitar errores de duplicados
  try {
    await Alert.collection.createIndex(
      { productRef: 1, type: 1, resolvedAt: 1 },
      {
        unique: false, // ← Cambiado a false
        name: 'idx_alert_productref_type_resolved',
      }
    );
    await Alert.collection.createIndex(
      { oldProductId: 1, type: 1, resolvedAt: 1 },
      {
        unique: false, // ← Cambiado a false
        name: 'idx_alert_oldproductid_type_resolved',
      }
    );
    console.log('[alertsService] Índices creados/verificados (no únicos)');
  } catch (err) {
    console.warn('[alertsService] Error creando índices:', err.message);
  }
};

const createAlertIfNotExists = async ({ productRef = null, oldProductId = null, type, message, meta = {} }) => {
  if (!Alert) await init();

  // Construir query de búsqueda más específica
  const query = { 
    type, 
    resolvedAt: null 
  };

  // Agregar condiciones específicas según los IDs disponibles
  if (productRef !== null && productRef !== undefined) {
    try {
      query.productRef = mongoose.Types.ObjectId.isValid(productRef) 
        ? new mongoose.Types.ObjectId(productRef) 
        : productRef;
    } catch (e) {
      query.productRef = productRef;
    }
  } else if (oldProductId !== null && oldProductId !== undefined) {
    query.oldProductId = oldProductId;
  } else {
    // Si ambos IDs son null, buscar por mensaje similar para evitar duplicados exactos
    query.message = message;
  }

  try {
    const existing = await Alert.findOne(query).lean();
    if (existing) {
      console.log(`[alertsService] Alerta ya existe: ${message}`);
      return existing;
    }

    const doc = await Alert.create({
      productRef: (productRef !== null && productRef !== undefined && mongoose.Types.ObjectId.isValid(productRef)) 
        ? new mongoose.Types.ObjectId(productRef) 
        : null,
      oldProductId: (oldProductId !== null && oldProductId !== undefined) ? oldProductId : null,
      type,
      message,
      meta: meta || {},
    });

    console.log(`[alertsService] Nueva alerta creada: ${message}`);
    return doc.toJSON();
  } catch (err) {
    // Si hay error de duplicado, buscar la alerta existente
    if (err.code === 11000) {
      console.log(`[alertsService] Error de duplicado, buscando alerta existente: ${message}`);
      const existing = await Alert.findOne(query).lean();
      if (existing) return existing;
    }
    throw err;
  }
};

const checkAndCreateAlerts = async () => {
  if (!Alert) await init();

  const products = (await productService.listarProductos?.()) || [];
  const now = new Date();
  const expiryCutoff = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const created = [];
  console.log(`[alertsService] Revisando ${products.length} productos para alertas...`);

  for (const p of products) {
    try {
      // Determinar IDs del producto
      const isMongoId = p && (p._id || (p.id && String(p.id).match(/^[0-9a-fA-F]{24}$/)));
      const productRef = p._id ? String(p._id) : (isMongoId && p.id ? String(p.id) : null);
      const oldProductId = (p.id && !productRef) ? p.id : null;

      console.log(`[alertsService] Producto: ${p.nombre}, productRef: ${productRef}, oldProductId: ${oldProductId}`);

      // Verificar stock bajo
      const stock = (p.stock == null) ? null : Number(p.stock);
      if (stock != null && stock <= LOW_STOCK_THRESHOLD) {
        const message = `Stock bajo: ${p.nombre || 'Sin nombre'} — quedan ${stock} unidades (umbral ${LOW_STOCK_THRESHOLD}).`;
        const alert = await createAlertIfNotExists({ 
          productRef, 
          oldProductId, 
          type: 'stock', 
          message, 
          meta: { stock, threshold: LOW_STOCK_THRESHOLD } 
        });
        if (alert) created.push(alert);
      }

      // Verificar vencimiento
      const vencStr = p.vencimiento;
      if (vencStr) {
        const d = new Date(String(vencStr).trim());
        if (!isNaN(d.getTime())) {
          if (d <= expiryCutoff) {
            const daysLeft = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
            const message = daysLeft < 0
              ? `Producto vencido: ${p.nombre || 'Sin nombre'} — venció hace ${Math.abs(daysLeft)} días (vto: ${d.toISOString().slice(0,10)}).`
              : `Producto por vencer: ${p.nombre || 'Sin nombre'} — queda(n) ${daysLeft} día(s) (vto: ${d.toISOString().slice(0,10)}).`;
            const alert = await createAlertIfNotExists({ 
              productRef, 
              oldProductId, 
              type: 'expiry', 
              message, 
              meta: { vencimiento: d.toISOString().slice(0,10), daysLeft } 
            });
            if (alert) created.push(alert);
          }
        }
      }
    } catch (err) {
      console.error(`[alertsService] Error procesando producto ${p.nombre}:`, err.message);
    }
  }

  console.log(`[alertsService] Proceso completado - ${created.length} alertas generadas/actualizadas`);
  return created;
};

const listAlerts = async ({ onlyUnresolved = true } = {}) => {
  if (!Alert) await init();
  const q = onlyUnresolved ? { resolvedAt: null } : {};
  const docs = await Alert.find(q).sort({ createdAt: -1 }).lean();
  
  const alerts = docs.map(d => {
    const alert = {
      id: String(d._id),
      type: d.type,
      message: d.message,
      meta: d.meta,
      resolved: !!d.resolvedAt,
      created_at: d.createdAt || d.created_at
    };
    if (d.productRef) alert.productRef = String(d.productRef);
    if (d.oldProductId) alert.oldProductId = d.oldProductId;
    return alert;
  });
  
  console.log(`[alertsService] Listando ${alerts.length} alertas`);
  return alerts;
};

const resolveAlert = async (id) => {
  if (!Alert) await init();
  
  const filter = mongoose.Types.ObjectId.isValid(id) 
    ? { _id: new mongoose.Types.ObjectId(id) } 
    : { _id: id };
    
  await Alert.updateOne(filter, { $set: { resolvedAt: new Date() } });
  const doc = await Alert.findOne(filter).lean();
  
  if (!doc) return null;
  
  const resolvedAlert = {
    id: String(doc._id),
    type: doc.type,
    message: doc.message,
    meta: doc.meta,
    resolved: true,
    created_at: doc.createdAt || doc.created_at,
    resolved_at: doc.resolvedAt
  };
  
  if (doc.productRef) resolvedAlert.productRef = String(doc.productRef);
  if (doc.oldProductId) resolvedAlert.oldProductId = doc.oldProductId;
  
  console.log(`[alertsService] Alerta ${id} resuelta`);
  return resolvedAlert;
};

module.exports = {
  init,
  checkAndCreateAlerts,
  listAlerts,
  resolveAlert,
  createAlertIfNotExists,
};