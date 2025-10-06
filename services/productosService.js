// src/services/productosService.js
const { connectMongo, mongoose } = require('../config/mongo');

let ProductModel = null;
let mongoReady = false;
const { Schema } = mongoose;

/* ---------- Schema / Init ---------- */
const ProductSchema = new Schema({
  oldId: { type: Schema.Types.Mixed, default: null }, // conserva id numérico si migrás desde sqlite
  nombre: { type: String, required: true, index: true },
  marca: { type: String, default: null, index: true },
  descripcion: { type: String, default: null },
  precio: { type: Number, default: null },
  categoria: { type: String, default: null, index: true },
  imagen: { type: String, default: null },
  vencimiento: { type: String, default: null }, // string para compatibilidad con formatos existentes
  stock: { type: Number, default: null },
  cost: { type: Number, default: 0 }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

ProductSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret.id || (ret._id ? String(ret._id) : (ret.oldId != null ? String(ret.oldId) : null));
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const init = async () => {
  await connectMongo();
  mongoReady = true;
  ProductModel = mongoose.models.Product || mongoose.model('Product', ProductSchema);

  try {
    await ProductModel.createIndexes();
    console.log('[productosService] índices creados/verificados');
  } catch (err) {
    console.warn('[productosService] fallo creando índices (quizá ya existen):', err.message || err);
  }
};

/* ---------- Helpers ---------- */
const isObjectId = (val) => typeof val === 'string' && mongoose.Types.ObjectId.isValid(val);

const normalize = (doc) => {
  if (!doc) return null;
  return {
    id: doc.id || (doc._id ? String(doc._id) : (doc.oldId != null ? String(doc.oldId) : null)),
    nombre: doc.nombre,
    marca: doc.marca ?? null,
    descripcion: doc.descripcion ?? null,
    precio: doc.precio != null ? Number(doc.precio) : null,
    categoria: doc.categoria ?? null,
    imagen: doc.imagen ?? null,
    vencimiento: doc.vencimiento ?? null,
    stock: doc.stock != null ? Number(doc.stock) : null,
    cost: doc.cost != null ? Number(doc.cost) : 0,
    created_at: doc.created_at || doc.createdAt || null,
    updated_at: doc.updated_at || doc.updatedAt || null,
    oldId: doc.oldId ?? null
  };
};

const ensureMongoReady = () => {
  if (!mongoReady || !ProductModel) throw new Error('productosService: MongoDB no inicializado. Llamá a init() primero.');
};

/* ---------- API ---------- */

/**
 * listarProductos({ categoria, marca })
 */
const listarProductos = async ({ categoria, marca } = {}) => {
  ensureMongoReady();
  const filter = {};
  if (categoria) filter.categoria = categoria;
  if (marca) filter.marca = marca;

  const docs = await ProductModel.find(filter)
    .collation({ locale: 'es', strength: 1 })
    .sort({ nombre: 1 })
    .lean()
    .exec();

  return docs.map(normalize);
};

/**
 * obtenerProductoPorId(id)
 * acepta ObjectId string o id numérico (oldId)
 */
const obtenerProductoPorId = async (id) => {
  ensureMongoReady();
  if (!id) return null;

  // ObjectId path
  if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
    const doc = await ProductModel.findById(String(id)).lean().exec();
    return normalize(doc);
  }

  // numeric oldId
  if (!isNaN(Number(id))) {
    const doc = await ProductModel.findOne({ oldId: Number(id) }).lean().exec();
    return normalize(doc);
  }

  // fallback: try findOne by _id field with given value
  const doc = await ProductModel.findOne({ _id: id }).lean().exec();
  return normalize(doc);
};

/**
 * crearProducto(payload)
 * payload puede incluir oldId para preservar id antiguo
 */
const crearProducto = async (payload = {}) => {
  ensureMongoReady();
  const {
    nombre,
    marca = null,
    descripcion = null,
    precio = null,
    categoria = null,
    imagen = null,
    vencimiento = null,
    stock = null,
    cost = 0,
    oldId = null
  } = payload;

  if (!nombre) throw new Error('nombre es requerido');

  const doc = await ProductModel.create({
    oldId: oldId != null ? oldId : null,
    nombre,
    marca,
    descripcion,
    precio: precio == null ? null : Number(precio),
    categoria,
    imagen,
    vencimiento,
    stock: stock == null ? null : Number(stock),
    cost: cost == null ? 0 : Number(cost)
  });

  const saved = await ProductModel.findById(doc._id).lean().exec();
  return normalize(saved);
};

/**
 * actualizarProducto(id, payload)
 */
const actualizarProducto = async (id, payload = {}) => {
  ensureMongoReady();
  let filter = null;
  if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) filter = { _id: mongoose.Types.ObjectId(id) };
  else if (!isNaN(Number(id))) filter = { oldId: Number(id) };
  else filter = { _id: id };

  const existing = await ProductModel.findOne(filter).lean().exec();
  if (!existing) throw new Error('Producto no encontrado');

  const updateDoc = {
    nombre: payload.hasOwnProperty('nombre') ? payload.nombre : existing.nombre,
    marca: payload.hasOwnProperty('marca') ? (payload.marca ?? null) : existing.marca,
    descripcion: payload.hasOwnProperty('descripcion') ? (payload.descripcion ?? null) : existing.descripcion,
    precio: payload.hasOwnProperty('precio') ? (payload.precio == null ? null : Number(payload.precio)) : existing.precio,
    categoria: payload.hasOwnProperty('categoria') ? (payload.categoria ?? null) : existing.categoria,
    imagen: payload.hasOwnProperty('imagen') ? (payload.imagen ?? null) : existing.imagen,
    vencimiento: payload.hasOwnProperty('vencimiento') ? (payload.vencimiento ?? null) : existing.vencimiento,
    stock: payload.hasOwnProperty('stock') ? (payload.stock == null ? null : Number(payload.stock)) : existing.stock,
    cost: payload.hasOwnProperty('cost') ? (payload.cost == null ? 0 : Number(payload.cost)) : (existing.cost != null ? existing.cost : 0),
    updated_at: new Date()
  };

  await ProductModel.updateOne(filter, { $set: updateDoc }).exec();
  const updated = await ProductModel.findOne(filter).lean().exec();
  return normalize(updated);
};

/**
 * eliminarProducto(id)
 */
const eliminarProducto = async (id) => {
  ensureMongoReady();
  let filter = null;
  if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) filter = { _id: mongoose.Types.ObjectId(id) };
  else if (!isNaN(Number(id))) filter = { oldId: Number(id) };
  else filter = { _id: id };

  const res = await ProductModel.deleteOne(filter).exec();
  return res.deletedCount > 0;
};

/**
 * topProductos(limit = 12)
 * Devuelve productos ordenados por cantidad vendida (sold_qty). Si no hay sale_items devuelve productos por nombre.
 */
const topProductos = async (limit = 12) => {
  ensureMongoReady();

  try {
    const saleItemsColl = mongoose.connection.collection('sale_items');

    const agg = await saleItemsColl.aggregate([
      {
        $group: {
          _id: { $ifNull: ['$productRef', '$product_id'] },
          sold_qty: { $sum: { $ifNull: ['$qty', 0] } }
        }
      },
      { $sort: { sold_qty: -1 } },
      { $limit: Number(limit) || 12 }
    ]).toArray();

    if (!Array.isArray(agg) || agg.length === 0) {
      // fallback to product listing
      const docs = await ProductModel.find().sort({ nombre: 1 }).limit(Number(limit) || 12).lean().exec();
      return docs.map(normalize);
    }

    // collect ids
    const ids = agg.map(a => a._id).filter(x => x != null);
    const objectIds = ids.filter(x => typeof x === 'string' && mongoose.Types.ObjectId.isValid(String(x))).map(x => mongoose.Types.ObjectId(String(x)));
    const numIds = ids.filter(x => !isNaN(Number(x))).map(x => Number(x));

    const prods = await ProductModel.find({
      $or: [
        { _id: { $in: objectIds } },
        { oldId: { $in: numIds } }
      ]
    }).lean().exec();

    // Merge sold_qty with products
    const result = agg.map(a => {
      const prod = prods.find(p => {
        if (p._id && String(p._id) === String(a._id)) return true;
        if (p.oldId != null && String(p.oldId) === String(a._id)) return true;
        return false;
      });
      const norm = normalize(prod || { oldId: a._id, nombre: 'Desconocido', stock: null, precio: null, cost: 0 });
      return { ...norm, sold_qty: Number(a.sold_qty || 0) };
    });

    return result;
  } catch (err) {
    console.warn('[productosService.topProductos] agregación falló, devolviendo listado simple:', err.message || err);
    const docs = await ProductModel.find().sort({ nombre: 1 }).limit(Number(limit) || 12).lean().exec();
    return docs.map(normalize);
  }
};

/**
 * searchProductos({ q, categoria, limit = 50, offset = 0 })
 */
const searchProductos = async ({ q, categoria, limit = 50, offset = 0 } = {}) => {
  ensureMongoReady();
  const filter = {};
  if (q) {
    const re = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ nombre: re }, { marca: re }, { descripcion: re }];
  }
  if (categoria) filter.categoria = categoria;

  const docs = await ProductModel.find(filter)
    .collation({ locale: 'es', strength: 1 })
    .sort({ nombre: 1 })
    .skip(Number(offset) || 0)
    .limit(Number(limit) || 50)
    .lean()
    .exec();

  return docs.map(normalize);
};

module.exports = {
  init,
  listarProductos,
  obtenerProductoPorId,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  topProductos,
  searchProductos
};