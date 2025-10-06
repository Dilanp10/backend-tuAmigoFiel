// src/services/customersService.js
const { connectMongo, mongoose } = require('../config/mongo');

const { Schema } = mongoose;

let CustomerModel = null;
let mongoReady = false;

/* ---------- Schema ---------- */
const CustomerSchema = new Schema({
  oldId: { type: Schema.Types.Mixed, default: null }, // conserva id numérico de sqlite si procede
  nombre: { type: String, required: true, index: true },
  email: { type: String, default: null, index: true },
  telefono: { type: String, default: null },
  monthly_interest: { type: Number, default: 0 },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

CustomerSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret.id || (ret._id ? String(ret._id) : (ret.oldId != null ? String(ret.oldId) : null));
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

/* ---------- init ---------- */
const init = async () => {
  await connectMongo();
  mongoReady = true;
  CustomerModel = mongoose.models.Customer || mongoose.model('Customer', CustomerSchema);
  try {
    await CustomerModel.createIndexes();
    console.log('[customersService] índices de Customer creados/verificados');
  } catch (err) {
    console.warn('[customersService] fallo creando índices (quizá ya existen):', err.message || err);
  }
};

/* ---------- Helpers ---------- */
const ensureMongoReady = () => {
  if (!mongoReady || !CustomerModel) throw new Error('customersService: MongoDB no inicializado. Llamá a init() primero.');
};

const isObjectId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v);

const normalize = (doc) => {
  if (!doc) return null;
  return {
    id: doc.id || (doc._id ? String(doc._id) : (doc.oldId != null ? String(doc.oldId) : null)),
    nombre: doc.nombre,
    email: doc.email ?? null,
    telefono: doc.telefono ?? null,
    monthly_interest: typeof doc.monthly_interest === 'number' ? doc.monthly_interest : (doc.monthly_interest == null ? 0 : Number(doc.monthly_interest)),
    created_at: doc.created_at || doc.createdAt || null,
    updated_at: doc.updated_at || doc.updatedAt || null,
    oldId: doc.oldId ?? null
  };
};

/* ---------- API ---------- */

/**
 * listCustomers({ q, limit=200, offset=0 })
 */
const listCustomers = async ({ q, limit = 200, offset = 0 } = {}) => {
  ensureMongoReady();
  const filter = {};
  if (q) {
    const re = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ nombre: re }, { email: re }, { telefono: re }];
  }

  const docs = await CustomerModel.find(filter)
    .sort({ nombre: 1 })
    .skip(Number(offset) || 0)
    .limit(Number(limit) || 200)
    .collation({ locale: 'es', strength: 1 })
    .lean()
    .exec();

  return docs.map(normalize);
};

/**
 * getCustomerById(id)
 * - acepta id mongo (_id string) o id numérico (old sqlite id)
 */
const getCustomerById = async (id) => {
  ensureMongoReady();
  if (!id) return null;

  // si es ObjectId válido, buscar por _id
  if (typeof id === 'string' && isObjectId(id)) {
    const doc = await CustomerModel.findById(id).lean().exec();
    return normalize(doc);
  }

  // si es numérico, buscar por oldId
  const maybeNum = Number(id);
  if (!isNaN(maybeNum)) {
    const doc = await CustomerModel.findOne({ oldId: maybeNum }).lean().exec();
    return normalize(doc);
  }

  // fallback: intentar buscar por _id con el valor dado
  const doc = await CustomerModel.findOne({ _id: id }).lean().exec();
  return normalize(doc);
};

/**
 * createCustomer(payload)
 * - si payload.oldId viene (cuando migrás), lo preserva
 */
const createCustomer = async (payload = {}) => {
  ensureMongoReady();
  const { nombre, email = null, telefono = null, monthly_interest = 0, oldId = null } = payload;
  if (!nombre) throw new Error('nombre es requerido');

  const doc = await CustomerModel.create({
    oldId: oldId != null ? oldId : null,
    nombre,
    email: email || null,
    telefono: telefono || null,
    monthly_interest: monthly_interest == null ? 0 : Number(monthly_interest)
  });

  const saved = await CustomerModel.findById(doc._id).lean().exec();
  return normalize(saved);
};

/**
 * updateCustomer(id, payload)
 */
const updateCustomer = async (id, payload = {}) => {
  ensureMongoReady();

  // localizar doc por _id o por oldId
  let filter = null;
  if (id && typeof id === 'string' && isObjectId(id)) {
    filter = { _id: mongoose.Types.ObjectId(id) };
  } else if (!isNaN(Number(id))) {
    filter = { oldId: Number(id) };
  } else {
    filter = { _id: id };
  }

  const existing = await CustomerModel.findOne(filter).lean().exec();
  if (!existing) throw new Error('Cliente no encontrado');

  const updateDoc = {
    nombre: payload.hasOwnProperty('nombre') ? payload.nombre : existing.nombre,
    email: payload.hasOwnProperty('email') ? (payload.email || null) : existing.email,
    telefono: payload.hasOwnProperty('telefono') ? (payload.telefono || null) : existing.telefono,
    monthly_interest: payload.hasOwnProperty('monthly_interest') ? (payload.monthly_interest == null ? 0 : Number(payload.monthly_interest)) : (existing.monthly_interest == null ? 0 : existing.monthly_interest),
    updated_at: new Date()
  };

  await CustomerModel.updateOne(filter, { $set: updateDoc }).exec();
  const updated = await CustomerModel.findOne(filter).lean().exec();
  return normalize(updated);
};

/**
 * deleteCustomer(id)
 */
const deleteCustomer = async (id) => {
  ensureMongoReady();
  let filter = null;
  if (id && typeof id === 'string' && isObjectId(id)) filter = { _id: mongoose.Types.ObjectId(id) };
  else if (!isNaN(Number(id))) filter = { oldId: Number(id) };
  else filter = { _id: id };

  const res = await CustomerModel.deleteOne(filter).exec();
  return res.deletedCount > 0;
};

module.exports = {
  init,
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer
};