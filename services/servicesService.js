// src/services/servicesService.js
const { all: sqliteAll, get: sqliteGet, run: sqliteRun } = require('./config/db.js');
const { connectMongo, mongoose } = require('./config/mongo');

/// --- Asegurar tabla SQLite (mantener comportamiento existente)
const ensure = async () => {
  try {
    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        precio REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (e) {
    console.warn('[servicesService.ensure] falló create table services', e.message || e);
  }
};
ensure().catch(()=>{});

/// --- Mongoose inline
const { Schema } = mongoose;
const ServiceSchema = new Schema({
  oldId: { type: Schema.Types.Mixed, default: null }, // conserva id sqlite
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

let ServiceModel = null;
let mongoReady = false;

const init = async () => {
  try {
    await connectMongo();
    mongoReady = true;
    ServiceModel = mongoose.models.Service || mongoose.model('Service', ServiceSchema);

    try {
      await ServiceModel.createIndexes();
      console.log('[servicesService] índices creados/verificados');
    } catch (err) {
      console.warn('[servicesService] fallo creando índices:', err.message || err);
    }
  } catch (err) {
    mongoReady = false;
    console.warn('[servicesService] Mongo no disponible, usando SQLite como fallback:', err.message || err);
  }
};

const normalize = (doc) => {
  if (!doc) return null;
  // doc puede venir de mongo (.lean()) o de sqlite
  if (doc._id || doc.created_at || doc.updated_at) {
    // probable doc mongo
    return {
      id: doc.id || (doc._id ? String(doc._id) : (doc.oldId != null ? String(doc.oldId) : null)),
      nombre: doc.nombre,
      descripcion: doc.descripcion || null,
      precio: (doc.precio != null) ? Number(doc.precio) : null,
      created_at: doc.created_at || doc.createdAt || null,
      updated_at: doc.updated_at || doc.updatedAt || null,
      oldId: doc.oldId ?? null,
    };
  }
  // sqlite row
  return {
    id: doc.id,
    nombre: doc.nombre,
    descripcion: doc.descripcion ?? null,
    precio: doc.precio != null ? Number(doc.precio) : null,
    created_at: doc.created_at || null,
    updated_at: doc.updated_at || null,
  };
};

/// --- listServices({ q, limit, offset })
const listServices = async ({ q, limit = 50, offset = 0 } = {}) => {
  if (mongoReady && ServiceModel) {
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
  }

  // fallback sqlite
  let sql = 'SELECT * FROM services';
  const params = [];
  const where = [];
  if (q) {
    where.push('(nombre LIKE ? OR descripcion LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY nombre COLLATE NOCASE LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  return await sqliteAll(sql, params);
};

/// --- getServiceById(id) acepta mongo _id o id numérico
const getServiceById = async (id) => {
  if (mongoReady && ServiceModel) {
    if (!id) return null;
    if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
      const doc = await ServiceModel.findById(id).lean().exec();
      return normalize(doc);
    }
    if (!isNaN(Number(id))) {
      const doc = await ServiceModel.findOne({ oldId: Number(id) }).lean().exec();
      if (doc) return normalize(doc);
    }
    // fallback intento por _id con el valor dado
    const doc = await ServiceModel.findOne({ _id: id }).lean().exec();
    return normalize(doc);
  }

  // sqlite fallback
  return await sqliteGet('SELECT * FROM services WHERE id = ?', [id]);
};

/// --- createService(payload)
const createService = async (payload) => {
  const { nombre, descripcion, precio, oldId } = payload || {};
  if (!nombre) throw new Error('nombre es requerido');

  if (mongoReady && ServiceModel) {
    const doc = await ServiceModel.create({
      oldId: oldId != null ? oldId : null,
      nombre,
      descripcion: descripcion || null,
      precio: precio == null ? null : Number(precio),
    });
    const saved = await ServiceModel.findById(doc._id).lean().exec();
    return normalize(saved);
  }

  // sqlite fallback
  const res = await sqliteRun(
    `INSERT INTO services (nombre, descripcion, precio) VALUES (?, ?, ?)`,
    [nombre, descripcion || null, precio == null ? null : precio]
  );
  return await sqliteGet('SELECT * FROM services WHERE id = ?', [res.lastID]);
};

/// --- updateService(id, payload)
const updateService = async (id, payload = {}) => {
  const { nombre, descripcion, precio } = payload;

  if (mongoReady && ServiceModel) {
    // localizar por _id o oldId
    let filter = null;
    if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) filter = { _id: mongoose.Types.ObjectId(id) };
    else if (!isNaN(Number(id))) filter = { oldId: Number(id) };
    else filter = { _id: id };

    const existing = await ServiceModel.findOne(filter).lean().exec();
    if (!existing) return null;

    const updateDoc = {
      nombre: payload.hasOwnProperty('nombre') ? nombre : existing.nombre,
      descripcion: payload.hasOwnProperty('descripcion') ? (descripcion || null) : existing.descripcion,
      precio: payload.hasOwnProperty('precio') ? (precio == null ? null : Number(precio)) : existing.precio,
      updated_at: new Date()
    };

    await ServiceModel.updateOne(filter, { $set: updateDoc }).exec();
    const updated = await ServiceModel.findOne(filter).lean().exec();
    return normalize(updated);
  }

  // sqlite fallback
  const existing = await sqliteGet('SELECT * FROM services WHERE id = ?', [id]);
  if (!existing) return null;

  const finalNombre = payload.hasOwnProperty('nombre') ? nombre : existing.nombre;
  const finalDescripcion = payload.hasOwnProperty('descripcion') ? descripcion : existing.descripcion;
  const finalPrecio = payload.hasOwnProperty('precio') ? (precio == null ? null : precio) : existing.precio;

  await sqliteRun(
    `UPDATE services SET nombre = ?, descripcion = ?, precio = ?, created_at = created_at WHERE id = ?`,
    [finalNombre, finalDescripcion, finalPrecio, id]
  );

  return await sqliteGet('SELECT * FROM services WHERE id = ?', [id]);
};

/// --- deleteService(id)
const deleteService = async (id) => {
  if (mongoReady && ServiceModel) {
    let filter = null;
    if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) filter = { _id: mongoose.Types.ObjectId(id) };
    else if (!isNaN(Number(id))) filter = { oldId: Number(id) };
    else filter = { _id: id };

    const res = await ServiceModel.deleteOne(filter).exec();
    return res.deletedCount > 0;
  }

  const res = await sqliteRun('DELETE FROM services WHERE id = ?', [id]);
  return res.changes > 0;
};

module.exports = {
  init,
  listServices,
  getServiceById,
  createService,
  updateService,
  deleteService
};