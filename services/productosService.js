// src/services/productosService.js
const { connectMongo, mongoose } = require('./config/mongo');
const { all: sqliteAll, get: sqliteGet, run: sqliteRun } = require('./config/db.js');

/**
 * Mantengo el intento de agregar columnas en sqlite (no cambiar).
 * Ignora errores si ya existen.
 */
const ensureColumns = async () => {
  try { await sqliteRun(`ALTER TABLE products ADD COLUMN vencimiento TEXT`); } catch (err) {}
  try { await sqliteRun(`ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 0`); } catch (err) {}
  try { await sqliteRun(`ALTER TABLE products ADD COLUMN cost REAL DEFAULT 0`); } catch (err) {}
  try { await sqliteRun(`ALTER TABLE sale_items ADD COLUMN unit_cost REAL DEFAULT 0`); } catch (err) {}
};
ensureColumns().catch(() => {});

// ------------------ Mongoose inline ------------------
const { Schema } = mongoose;
const ProductSchema = new Schema({
  oldId: { type: Schema.Types.Mixed, default: null }, // conserva id numérico sqlite
  nombre: { type: String, required: true, index: true },
  marca: { type: String, default: null, index: true },
  descripcion: { type: String, default: null },
  precio: { type: Number, default: null },
  categoria: { type: String, default: null, index: true },
  imagen: { type: String, default: null },
  vencimiento: { type: String, default: null }, // lo dejamos como string para compatibilidad (ISO o texto)
  stock: { type: Number, default: 0 },
  cost: { type: Number, default: 0 },
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

let ProductModel = null;
let mongoReady = false;

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

// Helper: normaliza salida para aproximar formato sqlite (devuelve id string)
const normalize = (doc) => {
  if (!doc) return null;
  // doc puede venir de .lean()
  const out = {
    id: doc.id || (doc._id ? String(doc._id) : (doc.oldId != null ? String(doc.oldId) : null)),
    nombre: doc.nombre,
    marca: doc.marca || null,
    descripcion: doc.descripcion || null,
    precio: typeof doc.precio === 'number' ? doc.precio : (doc.precio == null ? null : Number(doc.precio)),
    categoria: doc.categoria || null,
    imagen: doc.imagen || null,
    vencimiento: doc.vencimiento || null,
    stock: typeof doc.stock === 'number' ? doc.stock : (doc.stock == null ? null : Number(doc.stock)),
    cost: typeof doc.cost === 'number' ? doc.cost : (doc.cost == null ? 0 : Number(doc.cost)),
    created_at: doc.created_at || doc.createdAt || null,
    updated_at: doc.updated_at || doc.updatedAt || null,
    oldId: doc.oldId ?? null,
  };
  return out;
};

// ------------------ API ------------------

/**
 * listarProductos({ categoria, marca })
 */
const listarProductos = async ({ categoria, marca } = {}) => {
  if (mongoReady && ProductModel) {
    const filter = {};
    if (categoria) filter.categoria = categoria;
    if (marca) filter.marca = marca;
    const docs = await ProductModel.find(filter)
      .collation({ locale: 'es', strength: 1 })
      .sort({ nombre: 1 })
      .lean()
      .exec();
    return docs.map(normalize);
  }

  // fallback sqlite
  let sql = 'SELECT * FROM products';
  const params = [];
  const where = [];
  if (categoria) { where.push('categoria = ?'); params.push(categoria); }
  if (marca) { where.push('marca = ?'); params.push(marca); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY nombre COLLATE NOCASE';
  return await sqliteAll(sql, params);
};

/**
 * obtenerProductoPorId(id)
 * - acepta id mongo (_id string) o id numérico (old sqlite id)
 */
const obtenerProductoPorId = async (id) => {
  if (mongoReady && ProductModel) {
    // si es ObjectId
    if (id && typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
      const doc = await ProductModel.findById(id).lean().exec();
      return normalize(doc);
    }
    // si es numérico, buscar por oldId
    if (!isNaN(Number(id))) {
      const doc = await ProductModel.findOne({ oldId: Number(id) }).lean().exec();
      return normalize(doc);
    }
    // fallback: intentar buscar por _id tal cual
    const doc = await ProductModel.findOne({ _id: id }).lean().exec();
    return normalize(doc);
  }

  // sqlite fallback
  return await sqliteGet('SELECT * FROM products WHERE id = ?', [id]);
};

/**
 * crearProducto(payload)
 */
const crearProducto = async (payload) => {
  const { nombre, marca, descripcion, precio, categoria, imagen, vencimiento, stock, cost, oldId } = payload;
  if (mongoReady && ProductModel) {
    const doc = await ProductModel.create({
      oldId: oldId != null ? oldId : null,
      nombre,
      marca: marca || null,
      descripcion: descripcion || null,
      precio: precio == null ? null : Number(precio),
      categoria: categoria || null,
      imagen: imagen || null,
      vencimiento: vencimiento || null,
      stock: stock == null ? (stock === 0 ? 0 : null) : Number(stock),
      cost: cost == null ? 0 : Number(cost),
    });
    const saved = await ProductModel.findById(doc._id).lean().exec();
    return normalize(saved);
  }

  // sqlite fallback
  const result = await sqliteRun(
    `INSERT INTO products (nombre, marca, descripcion, precio, categoria, imagen, vencimiento, stock, cost, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      nombre,
      marca || null,
      descripcion || null,
      precio == null ? null : precio,
      categoria || null,
      imagen || null,
      vencimiento || null,
      stock == null ? null : stock,
      cost == null ? 0 : cost,
    ]
  );
  return await obtenerProductoPorId(result.lastID);
};

/**
 * actualizarProducto(id, payload)
 */
const actualizarProducto = async (id, payload) => {
  if (mongoReady && ProductModel) {
    // localizar por _id o oldId
    let filter = null;
    if (id && typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) filter = { _id: mongoose.Types.ObjectId(id) };
    else if (!isNaN(Number(id))) filter = { oldId: Number(id) };
    else filter = { _id: id };

    const existing = await ProductModel.findOne(filter).lean().exec();
    if (!existing) throw new Error('Producto no encontrado');

    const updateDoc = {
      nombre: payload.hasOwnProperty('nombre') ? payload.nombre : existing.nombre,
      marca: payload.hasOwnProperty('marca') ? (payload.marca || null) : existing.marca,
      descripcion: payload.hasOwnProperty('descripcion') ? (payload.descripcion || null) : existing.descripcion,
      precio: payload.hasOwnProperty('precio') ? (payload.precio == null ? null : Number(payload.precio)) : existing.precio,
      categoria: payload.hasOwnProperty('categoria') ? payload.categoria : existing.categoria,
      imagen: payload.hasOwnProperty('imagen') ? (payload.imagen || null) : existing.imagen,
      vencimiento: payload.hasOwnProperty('vencimiento') ? (payload.vencimiento || null) : existing.vencimiento,
      stock: payload.hasOwnProperty('stock') ? (payload.stock == null ? null : Number(payload.stock)) : existing.stock,
      cost: payload.hasOwnProperty('cost') ? (payload.cost == null ? 0 : Number(payload.cost)) : (existing.cost != null ? existing.cost : 0),
    };

    await ProductModel.updateOne(filter, { $set: updateDoc, $currentDate: { updated_at: true } }).exec();
    const updated = await ProductModel.findOne(filter).lean().exec();
    return normalize(updated);
  }

  // sqlite fallback
  const existing = await obtenerProductoPorId(id);
  if (!existing) throw new Error('Producto no encontrado');

  const finalNombre = payload.hasOwnProperty('nombre') ? payload.nombre : existing.nombre;
  const finalMarca = payload.hasOwnProperty('marca') ? payload.marca : existing.marca;
  const finalDescripcion = payload.hasOwnProperty('descripcion') ? payload.descripcion : existing.descripcion;
  const finalPrecio = payload.hasOwnProperty('precio') ? (payload.precio == null ? null : payload.precio) : existing.precio;
  const finalCategoria = payload.hasOwnProperty('categoria') ? payload.categoria : existing.categoria;
  const finalImagen = payload.hasOwnProperty('imagen') ? payload.imagen : existing.imagen;
  const finalVencimiento = payload.hasOwnProperty('vencimiento') ? payload.vencimiento : existing.vencimiento;
  const finalStock = payload.hasOwnProperty('stock') ? (payload.stock == null ? null : payload.stock) : existing.stock;
  const finalCost = payload.hasOwnProperty('cost') ? (payload.cost == null ? 0 : payload.cost) : (existing.cost != null ? existing.cost : 0);

  await sqliteRun(
    `UPDATE products
     SET nombre = ?, marca = ?, descripcion = ?, precio = ?, categoria = ?, imagen = ?, vencimiento = ?, stock = ?, cost = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      finalNombre == null ? null : finalNombre,
      finalMarca == null ? null : finalMarca,
      finalDescripcion == null ? null : finalDescripcion,
      finalPrecio == null ? null : finalPrecio,
      finalCategoria == null ? null : finalCategoria,
      finalImagen == null ? null : finalImagen,
      finalVencimiento == null ? null : finalVencimiento,
      finalStock == null ? null : finalStock,
      finalCost,
      id,
    ]
  );

  return await obtenerProductoPorId(id);
};

/**
 * eliminarProducto(id)
 */
const eliminarProducto = async (id) => {
  if (mongoReady && ProductModel) {
    let filter = null;
    if (id && typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) filter = { _id: mongoose.Types.ObjectId(id) };
    else if (!isNaN(Number(id))) filter = { oldId: Number(id) };
    else filter = { _id: id };
    const res = await ProductModel.deleteOne(filter).exec();
    return res.deletedCount > 0;
  }

  try {
    const result = await sqliteRun('DELETE FROM products WHERE id = ?', [id]);
    return result.changes > 0;
  } catch (err) {
    console.error('[productoService.eliminarProducto]', err);
    throw err;
  }
};

/**
 * topProductos(limit = 12)
 * - si hay datos en sale_items en mongo intenta aggregar por ventas; si no, fallback a sqlite query o por nombre
 */
const topProductos = async (limit = 12) => {
  if (mongoReady && ProductModel) {
    try {
      // intentamos agrupar por coleccion sale_items si existe
      const coll = mongoose.connection.collection('sale_items');
      // aggregate puede fallar si la colección no existe o el shape es distinto
      const agg = await coll.aggregate([
        {
          $group: {
            _id: { $ifNull: ['$productRef', '$product_id'] },
            sold_qty: { $sum: { $ifNull: ['$qty', 0] } }
          }
        },
        { $sort: { sold_qty: -1 } },
        { $limit: Number(limit) },
      ]).toArray();

      // mapear ids para buscar productos
      const ids = agg.map(a => a._id).filter(x => x != null);
      // buscar productos por oldId o _id
      const mongoIds = ids.filter(x => typeof x === 'string' && mongoose.Types.ObjectId.isValid(String(x))).map(x => mongoose.Types.ObjectId(String(x)));
      const numIds = ids.filter(x => !isNaN(Number(x))).map(x => Number(x));

      const prods = await ProductModel.find({
        $or: [
          { _id: { $in: mongoIds } },
          { oldId: { $in: numIds } }
        ]
      }).lean().exec();

      // combinar sold_qty con productos encontrados
      return agg.map(a => {
        const prod = prods.find(p => {
          if (p._id && String(p._id) === String(a._id)) return true;
          if (p.oldId != null && String(p.oldId) === String(a._id)) return true;
          return false;
        });
        return normalize(prod || { oldId: a._id, nombre: 'Desconocido', stock: null, precio: null, cost: 0 });
      });
    } catch (err) {
      // fallback a buscar productos por nombre
      console.warn('[productosService.topProductos] agregación mongo falló, fallback:', err.message || err);
      const docs = await ProductModel.find().sort({ nombre: 1 }).limit(Number(limit)).lean().exec();
      return docs.map(normalize);
    }
  }

  // sqlite fallback (consulta original con sale_items)
  try {
    const sql = `
      SELECT p.*, COALESCE(SUM(si.qty),0) as sold_qty
      FROM products p
      LEFT JOIN sale_items si ON si.product_id = p.id
      GROUP BY p.id
      ORDER BY sold_qty DESC
      LIMIT ?
    `;
    return await sqliteAll(sql, [Number(limit)]);
  } catch (err) {
    // fallback simple
    return await sqliteAll('SELECT * FROM products ORDER BY nombre LIMIT ?', [Number(limit)]);
  }
};

/**
 * searchProductos({ q, categoria, limit = 50, offset = 0 })
 */
const searchProductos = async ({ q, categoria, limit = 50, offset = 0 } = {}) => {
  if (mongoReady && ProductModel) {
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
  }

  // sqlite fallback
  let sql = 'SELECT * FROM products';
  const params = [];
  const where = [];
  if (q) {
    where.push('(nombre LIKE ? OR marca LIKE ? OR descripcion LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (categoria) {
    where.push('categoria = ?');
    params.push(categoria);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY nombre COLLATE NOCASE LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  return await sqliteAll(sql, params);
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