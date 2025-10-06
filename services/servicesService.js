// src/services/servicesService.js
const { connectMongo, mongoose } = require('../config/mongo');

let ServiceModel = null;
let mongoReady = false;

const { Schema } = mongoose;

const ServiceSchema = new Schema({
  oldId: { type: Schema.Types.Mixed, default: null }, // conserva id numérico si migrás desde sqlite
  nombre: { type: String, required: true, index: true },
  descripcion: { type: String, default: null },
  precio: { type: Number, default: null },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

ServiceSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret.id || (ret._id ? String(ret._id) : (ret.oldId != null ? String(ret.oldId) : null));
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const init = async () => {
  console.log('[DEBUG] servicesService.init() llamado');
  try {
    await connectMongo();
    console.log('[DEBUG] MongoDB conectado desde servicesService');
    mongoReady = true;
    ServiceModel = mongoose.models.Service || mongoose.model('Service', ServiceSchema);
    console.log('[DEBUG] ServiceModel inicializado');

    try {
      await ServiceModel.createIndexes();
      console.log('[servicesService] índices creados/verificados');
    } catch (err) {
      console.warn('[servicesService] fallo creando índices:', err.message || err);
    }
  } catch (err) {
    console.error('[DEBUG] Error en servicesService.init():', err);
    throw err;
  }
};

const isObjectId = (val) => typeof val === 'string' && mongoose.Types.ObjectId.isValid(val);

const normalize = (doc) => {
  if (!doc) return null;
  return {
    id: doc.id || (doc._id ? String(doc._id) : (doc.oldId != null ? String(doc.oldId) : null)),
    nombre: doc.nombre,
    descripcion: doc.descripcion ?? null,
    precio: doc.precio != null ? Number(doc.precio) : null,
    created_at: doc.created_at || doc.createdAt || null,
    updated_at: doc.updated_at || doc.updatedAt || null,
    oldId: doc.oldId ?? null,
  };
};

/* ---------- Helpers ---------- */
const ensureMongoReady = async () => {
  if (!mongoReady || !ServiceModel) {
    console.log('🔄 Auto-inicializando servicesService...');
    await init();
  }
};

/* ---------- listServices({ q, limit, offset }) ---------- */
const listServices = async ({ q, limit = 50, offset = 0 } = {}) => {
  await ensureMongoReady();
  const filter = {};
  if (q) {
    const re = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ nombre: re }, { descripcion: re }];
  }
  const docs = await ServiceModel.find(filter)
    .collation({ locale: 'es', strength: 1 })
    .sort({ nombre: 1 })
    .skip(Number(offset) || 0)
    .limit(Number(limit) || 50)
    .lean()
    .exec();
  return docs.map(normalize);
};

/* ---------- getServiceById(id) ---------- */
const getServiceById = async (id) => {
  await ensureMongoReady();
  if (!id) return null;

  // si es ObjectId
  if (isObjectId(String(id))) {
    const doc = await ServiceModel.findById(String(id)).lean().exec();
    return normalize(doc);
  }

  // si es numérico, buscar por oldId
  if (!isNaN(Number(id))) {
    const doc = await ServiceModel.findOne({ oldId: Number(id) }).lean().exec();
    if (doc) return normalize(doc);
  }

  // fallback: intentar buscar por _id con el valor dado
  const doc = await ServiceModel.findOne({ _id: id }).lean().exec();
  return normalize(doc);
};

/* ---------- createService(payload) ---------- */
const createService = async (payload = {}) => {
  await ensureMongoReady();
  const { nombre, descripcion = null, precio = null, oldId = null } = payload;
  if (!nombre) throw new Error('nombre es requerido');

  const doc = await ServiceModel.create({
    oldId: oldId != null ? oldId : null,
    nombre,
    descripcion,
    precio: precio == null ? null : Number(precio)
  });

  const saved = await ServiceModel.findById(doc._id).lean().exec();
  return normalize(saved);
};

/* ---------- updateService(id, payload) ---------- */
const updateService = async (id, payload = {}) => {
  await ensureMongoReady();

  let filter = null;
  if (isObjectId(String(id))) filter = { _id: mongoose.Types.ObjectId(String(id)) };
  else if (!isNaN(Number(id))) filter = { oldId: Number(id) };
  else filter = { _id: id };

  const existing = await ServiceModel.findOne(filter).lean().exec();
  if (!existing) return null;

  const updateDoc = {
    nombre: payload.hasOwnProperty('nombre') ? payload.nombre : existing.nombre,
    descripcion: payload.hasOwnProperty('descripcion') ? (payload.descripcion ?? null) : existing.descripcion,
    precio: payload.hasOwnProperty('precio') ? (payload.precio == null ? null : Number(payload.precio)) : existing.precio,
    updated_at: new Date()
  };

  await ServiceModel.updateOne(filter, { $set: updateDoc }).exec();
  const updated = await ServiceModel.findOne(filter).lean().exec();
  return normalize(updated);
};

/* ---------- deleteService(id) ---------- */
const deleteService = async (id) => {
  await ensureMongoReady();

  let filter = null;
  if (isObjectId(String(id))) filter = { _id: mongoose.Types.ObjectId(String(id)) };
  else if (!isNaN(Number(id))) filter = { oldId: Number(id) };
  else filter = { _id: id };

  const res = await ServiceModel.deleteOne(filter).exec();
  return res.deletedCount > 0;
};

module.exports = {
  init,
  listServices,
  getServiceById,
  createService,
  updateService,
  deleteService
};