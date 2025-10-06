// src/services/customersService.js
const { connectMongo, mongoose } = require('../config/mongo');
const { all: sqliteAll, get: sqliteGet, run: sqliteRun } = require('../config/db.js'); // fallback sqlite

const { Schema } = mongoose;

const CustomerSchema = new Schema({
  oldId: { type: Schema.Types.Mixed, default: null }, // conserva id numérico de sqlite si procede
  nombre: { type: String, required: true, index: true },
  email: { type: String, default: null, index: true },
  telefono: { type: String, default: null },
  monthly_interest: { type: Number, default: 0 },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// toJSON friendly: devuelve 'id' en vez de '_id' y elimina __v
CustomerSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

let CustomerModel = null;
let mongoReady = false;

// Inicializa conexión y modelo (llamar en server.js)
const init = async () => {
  await connectMongo();
  mongoReady = true;
  CustomerModel = mongoose.models.Customer || mongoose.model('Customer', CustomerSchema);

  // índices: nombre y email para búsquedas rápidas
  try {
    await CustomerModel.createIndexes();
    console.log('[customersService] índices de Customer creados/verificados');
  } catch (err) {
    console.warn('[customersService] fallo creando índices (quizá ya existen):', err.message);
  }
};

/**
 * Helper interno: transforma documento mongo a formato compatible con el antiguo sqlite
 */
const normalize = (doc) => {
  if (!doc) return null;
  // si viene de mongo (lean) puede tener _id ya transformado, pero aseguramos campos
  const out = {
    id: doc.id || (doc._id ? String(doc._id) : (doc.oldId != null ? String(doc.oldId) : null)),
    nombre: doc.nombre,
    email: doc.email || null,
    telefono: doc.telefono || null,
    monthly_interest: typeof doc.monthly_interest === 'number' ? doc.monthly_interest : (doc.monthly_interest == null ? 0 : Number(doc.monthly_interest)),
    created_at: doc.created_at || doc.createdAt || null,
    updated_at: doc.updated_at || doc.updatedAt || null,
    oldId: doc.oldId || null,
  };
  return out;
};

/**
 * listCustomers({ q, limit=200, offset=0 })
 * - si Mongo está listo usa Mongo; si no, usa sqlite (fallback)
 */
const listCustomers = async ({ q, limit = 200, offset = 0 } = {}) => {
  if (mongoReady && CustomerModel) {
    const filter = {};
    if (q) {
      const re = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { nombre: re },
        { email: re },
        { telefono: re },
      ];
    }
    const docs = await CustomerModel.find(filter)
      .sort({ nombre: 1 })
      .skip(Number(offset) || 0)
      .limit(Number(limit) || 200)
      .collation({ locale: 'es', strength: 1 }) // orden case-insensitive
      .lean()
      .exec();
    return docs.map(normalize);
  }

  // fallback sqlite
  let sql = 'SELECT * FROM customers';
  const where = [];
  const params = [];
  if (q) {
    where.push('(nombre LIKE ? OR email LIKE ? OR telefono LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY nombre COLLATE NOCASE LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  return await sqliteAll(sql, params);
};

/**
 * getCustomerById(id)
 * - acepta id mongo (_id string) o id numérico (old sqlite id)
 */
const getCustomerById = async (id) => {
  if (mongoReady && CustomerModel) {
    // si es ObjectId válido, buscar por _id
    if (id && typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
      const doc = await CustomerModel.findById(id).lean().exec();
      return normalize(doc);
    }
    // si es numérico, buscar por oldId
    const maybeNum = Number(id);
    if (!isNaN(maybeNum)) {
      const doc = await CustomerModel.findOne({ oldId: maybeNum }).lean().exec();
      return normalize(doc);
    }
    // fallback: intentar buscar por id tal cual
    const doc = await CustomerModel.findOne({ _id: id }).lean().exec();
    return normalize(doc);
  }

  // fallback sqlite
  return await sqliteGet('SELECT * FROM customers WHERE id = ?', [id]);
};

/**
 * createCustomer(payload)
 * - si payload.oldId viene (cuando migrás), lo preserva
 */
const createCustomer = async (payload) => {
  const { nombre, email, telefono, monthly_interest, oldId } = payload;
  if (mongoReady && CustomerModel) {
    const doc = await CustomerModel.create({
      oldId: oldId != null ? oldId : null,
      nombre,
      email: email || null,
      telefono: telefono || null,
      monthly_interest: monthly_interest == null ? 0 : Number(monthly_interest),
    });
    const saved = await CustomerModel.findById(doc._id).lean().exec();
    return normalize(saved);
  }

  // fallback sqlite
  const res = await sqliteRun(
    `INSERT INTO customers (nombre, email, telefono, monthly_interest) VALUES (?, ?, ?, ?)`,
    [nombre, email || null, telefono || null, monthly_interest == null ? 0 : Number(monthly_interest)]
  );
  return await getCustomerById(res.lastID);
};

/**
 * updateCustomer(id, payload)
 */
const updateCustomer = async (id, payload) => {
  if (mongoReady && CustomerModel) {
    // localizar doc por _id o por oldId
    let filter = null;
    if (id && typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
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
    };

    await CustomerModel.updateOne(filter, { $set: updateDoc, $currentDate: { updated_at: true } }).exec();

    // devolver actualizado
    const updated = await CustomerModel.findOne(filter).lean().exec();
    return normalize(updated);
  }

  // fallback sqlite
  const existing = await getCustomerById(id);
  if (!existing) throw new Error('Cliente no encontrado');

  const nombre = payload.hasOwnProperty('nombre') ? payload.nombre : existing.nombre;
  const email = payload.hasOwnProperty('email') ? payload.email : existing.email;
  const telefono = payload.hasOwnProperty('telefono') ? payload.telefono : existing.telefono;
  const monthly_interest = payload.hasOwnProperty('monthly_interest') ? payload.monthly_interest : existing.monthly_interest;

  await sqliteRun(
    `UPDATE customers SET nombre = ?, email = ?, telefono = ?, monthly_interest = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [nombre, email || null, telefono || null, monthly_interest == null ? 0 : Number(monthly_interest), id]
  );
  return await getCustomerById(id);
};

/**
 * deleteCustomer(id)
 */
const deleteCustomer = async (id) => {
  if (mongoReady && CustomerModel) {
    let filter = null;
    if (id && typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
      filter = { _id: mongoose.Types.ObjectId(id) };
    } else if (!isNaN(Number(id))) {
      filter = { oldId: Number(id) };
    } else {
      filter = { _id: id };
    }
    const res = await CustomerModel.deleteOne(filter).exec();
    return res.deletedCount > 0;
  }

  // fallback sqlite
  const res = await sqliteRun('DELETE FROM customers WHERE id = ?', [id]);
  return res.changes > 0;
};

module.exports = {
  init,
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
};