// src/services/salesService.js
const { connectMongo, mongoose } = require('../config/mongo');
const productosService = require('./productosService');
const customersService = require('./customersService');

const USE_SELL_PRICE_AS_COST = (process.env.USE_SELL_PRICE_AS_COST === 'true');

let SaleModel = null;
let mongoReady = false;

const { Schema } = mongoose;

/* ---------- Mongoose Schemas (inline) ---------- */
const SaleItemSchema = new Schema({
  productRef: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  oldProductId: { type: Schema.Types.Mixed, default: null },
  serviceRef: { type: Schema.Types.ObjectId, ref: 'Service', default: null },
  oldServiceId: { type: Schema.Types.Mixed, default: null },

  qty: { type: Number, required: true },
  unit_price: { type: Number, default: 0 },
  unit_cost: { type: Number, default: 0 },
  line_total: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
}, { _id: false });

const SaleSchema = new Schema({
  oldId: { type: Schema.Types.Mixed, default: null },
  items: { type: [SaleItemSchema], default: [] },
  customerRef: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  oldCustomerId: { type: Schema.Types.Mixed, default: null },

  total: { type: Number, default: 0 },
  total_items: { type: Number, default: 0 },
  paid_amount: { type: Number, default: 0 },
  outstanding_amount: { type: Number, default: 0 },
  on_credit: { type: Boolean, default: false },
  status: { type: String, default: 'pending' },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

SaleSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret.id || (ret._id ? String(ret._id) : (ret.oldId != null ? String(ret.oldId) : null));
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

/* ---------- init() ---------- */
const init = async () => {
  await connectMongo();
  mongoReady = true;
  SaleModel = mongoose.models.Sale || mongoose.model('Sale', SaleSchema);

  try {
    await SaleModel.collection.createIndex({ oldId: 1 });
    await SaleModel.collection.createIndex({ customerRef: 1 });
    await SaleModel.collection.createIndex({ oldCustomerId: 1 });
    await SaleModel.collection.createIndex({ created_at: -1 });
    console.log('[salesService] índices creados/verificados');
  } catch (err) {
    console.warn('[salesService] fallo creando índices (quizá ya existían):', err.message || err);
  }
};

/* ---------- Helpers ---------- */
const isObjectId = (val) => typeof val === 'string' && mongoose.Types.ObjectId.isValid(val);

/* ---------- normalizeSale (mongo) ---------- */
const normalizeSale = async (doc) => {
  if (!doc) return null;
  const sale = {
    id: doc.id || (doc._id ? String(doc._id) : (doc.oldId != null ? String(doc.oldId) : null)),
    items: (doc.items || []).map(it => ({
      productRef: it.productRef || null,
      oldProductId: it.oldProductId ?? null,
      serviceRef: it.serviceRef || null,
      oldServiceId: it.oldServiceId ?? null,
      qty: it.qty,
      unit_price: it.unit_price,
      unit_cost: it.unit_cost,
      line_total: it.line_total,
      created_at: it.created_at || it.createdAt || null
    })),
    total: doc.total,
    total_items: doc.total_items,
    paid_amount: doc.paid_amount,
    outstanding_amount: doc.outstanding_amount,
    on_credit: !!doc.on_credit,
    status: doc.status || 'pending',
    created_at: doc.created_at || doc.createdAt || null,
    updated_at: doc.updated_at || doc.updatedAt || null,
    customer: null,
    raw: doc
  };

  // populate customer if possible (customersService should accept mongo id or oldId)
  try {
    const cid = (doc.oldCustomerId != null) ? doc.oldCustomerId : (doc.customerRef ? String(doc.customerRef) : null);
    if (cid) {
      const c = await customersService.getCustomerById(cid);
      sale.customer = c || null;
    }
  } catch (e) { /* ignore */ }

  return sale;
};

/* ---------- createSale ---------- */
/**
 * cart: [{ id, qty, precio?, type?: 'product'|'service' }]
 * options: { customerId, onCredit, paidAmount }
 */
const createSale = async (cart = [], options = {}) => {
  if (!Array.isArray(cart) || cart.length === 0) throw new Error('Carrito vacío');

  const {
    customerId = null,
    onCredit = false,
    paidAmount = 0
  } = options;

  const paid = Number(paidAmount) || 0;
  if (onCredit && paid < 0) throw new Error('Monto pagado no puede ser negativo');

  // Validate & prepare lines using productosService (assumed migrated)
  const itemsToSave = [];
  let total = 0;
  let totalItems = 0;

  for (const it of cart) {
    const qty = Number(it.qty || 0);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Cantidad inválida para item id=${it.id}`);

    const type = it.type || 'product';
    let product = null;
    let service = null;

    if (type === 'product') {
      product = await productosService.obtenerProductoPorId(it.id);
      if (!product) throw new Error(`Producto no encontrado (id=${it.id})`);
      const stock = product.stock == null ? null : Number(product.stock);
      if (stock != null && stock < qty) throw new Error(`Stock insuficiente para ${product.nombre || ('id='+product.id)}`);
    } else if (type === 'service') {
      service = { id: it.id }; // si luego migrás services a Mongo, podés validar aquí
    }

    const unitPrice = (it.precio != null) ? Number(it.precio) : (product ? Number(product.precio || 0) : 0);
    if (!Number.isFinite(unitPrice)) throw new Error(`Precio inválido para item id=${it.id}`);

    const unitCost = product && (product.cost != null) ? Number(product.cost) : (USE_SELL_PRICE_AS_COST ? unitPrice : 0);

    const line_total = unitPrice * qty;
    itemsToSave.push({
      type,
      id: it.id,
      product,
      service,
      qty,
      unitPrice,
      unitCost,
      line_total
    });

    total += line_total;
    totalItems += qty;
  }

  const outstanding = onCredit ? Math.max(0, total - paid) : 0;
  const finalPaidAmount = onCredit ? Math.min(paid, total) : total;

  if (!mongoReady || !SaleModel) throw new Error('MongoDB no inicializado');

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const saleDocArray = await SaleModel.create([{
      oldId: null,
      items: itemsToSave.map(it => ({
        productRef: (it.product && it.product.id && isObjectId(String(it.product.id))) ? mongoose.Types.ObjectId(String(it.product.id)) : null,
        oldProductId: (it.product && it.product.id && !isObjectId(String(it.product.id))) ? it.product.id : null,
        serviceRef: null,
        oldServiceId: (it.service && it.service.id && !isObjectId(String(it.service.id))) ? it.service.id : null,
        qty: it.qty,
        unit_price: it.unitPrice,
        unit_cost: it.unitCost,
        line_total: it.line_total
      })),
      customerRef: (customerId && isObjectId(String(customerId))) ? mongoose.Types.ObjectId(String(customerId)) : null,
      oldCustomerId: (customerId && !isObjectId(String(customerId))) ? customerId : null,
      total,
      total_items: totalItems,
      paid_amount: finalPaidAmount,
      outstanding_amount: outstanding,
      on_credit: !!onCredit,
      status: outstanding <= 0 ? 'paid' : (finalPaidAmount > 0 ? 'partially_paid' : 'pending')
    }], { session });

    // update product stocks if applicable
    for (const ln of itemsToSave) {
      if (ln.type === 'product' && ln.product && ln.product.id) {
        // if product.id looks like old numeric id, attempt productosService.actualizarProducto (productosService should handle oldId)
        if (!isObjectId(String(ln.product.id))) {
          try {
            const current = await productosService.obtenerProductoPorId(ln.product.id);
            const newStock = (current && current.stock != null) ? Math.max(0, Number(current.stock) - ln.qty) : null;
            if (newStock != null) {
              await productosService.actualizarProducto(ln.product.id, { stock: newStock });
            }
          } catch (e) {
            // no abortamos por fallo de stock update externo
            console.warn('[salesService] no se pudo actualizar stock mediante productosService:', e.message || e);
          }
        } else {
          // mongo product id -> update collection directly in session
          try {
            await mongoose.connection.collection('products').updateOne(
              { _id: mongoose.Types.ObjectId(String(ln.product.id)), stock: { $ne: null } },
              { $inc: { stock: -ln.qty } },
              { session }
            );
          } catch (e) {
            console.warn('[salesService] fallo al decrementar stock en colección products:', e.message || e);
          }
        }
      }
    }

    await session.commitTransaction();
    session.endSession();

    const saved = await SaleModel.findById(saleDocArray[0]._id).lean().exec();
    return await normalizeSale(saved);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
};

/* ---------- listSales ---------- */
const listSales = async ({ from, to, limit = 100, offset = 0, customerId, creditOnly = false } = {}) => {
  if (!mongoReady || !SaleModel) throw new Error('MongoDB no inicializado');

  const match = {};
  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) match.created_at = { ...(match.created_at || {}), $gte: fromDate };
  }
  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) {
      const toInclusive = new Date(toDate.getTime()); toInclusive.setHours(23, 59, 59, 999);
      match.created_at = { ...(match.created_at || {}), $lte: toInclusive };
    }
  }

  if (customerId) {
    if (typeof customerId === 'string' && isObjectId(customerId)) match.customerRef = mongoose.Types.ObjectId(customerId);
    else if (!isNaN(Number(customerId))) match.oldCustomerId = Number(customerId);
    else match.customerRef = customerId;
  }

  if (creditOnly) match.on_credit = true;

  const docs = await SaleModel.find(match)
    .sort({ created_at: -1 })
    .skip(Number(offset) || 0)
    .limit(Number(limit) || 100)
    .lean()
    .exec();

  const out = [];
  for (const d of docs) out.push(await normalizeSale(d));
  return out;
};

/* ---------- getSaleById ---------- */
const getSaleById = async (id) => {
  if (!id) return null;
  if (!mongoReady || !SaleModel) throw new Error('MongoDB no inicializado');

  if (isObjectId(String(id))) {
    const doc = await SaleModel.findById(String(id)).lean().exec();
    return await normalizeSale(doc);
  }
  if (!isNaN(Number(id))) {
    const doc = await SaleModel.findOne({ oldId: Number(id) }).lean().exec();
    return await normalizeSale(doc);
  }
  const doc = await SaleModel.findOne({ _id: id }).lean().exec();
  return await normalizeSale(doc);
};

/* ---------- updateSalePayment ---------- */
const updateSalePayment = async (saleId, paidAmount) => {
  const amt = Number(paidAmount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('amount inválido');
  if (!mongoReady || !SaleModel) throw new Error('MongoDB no inicializado');

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    let saleDoc = null;
    if (isObjectId(String(saleId))) {
      saleDoc = await SaleModel.findById(String(saleId)).session(session).exec();
    }
    if (!saleDoc && !isNaN(Number(saleId))) {
      saleDoc = await SaleModel.findOne({ oldId: Number(saleId) }).session(session).exec();
    }
    if (!saleDoc) throw new Error('Venta no encontrada');
    if (!saleDoc.on_credit) throw new Error('Esta venta no es a crédito');

    saleDoc.paid_amount = (saleDoc.paid_amount || 0) + amt;
    saleDoc.outstanding_amount = Math.max(0, (saleDoc.outstanding_amount || saleDoc.total || 0) - amt);
    saleDoc.status = saleDoc.outstanding_amount <= 0 ? 'paid' : 'partially_paid';

    await saleDoc.save({ session });
    await session.commitTransaction();
    session.endSession();

    return { ok: true, sale: await getSaleById(saleDoc._id) };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
};

/* ---------- getCustomerOutstanding ---------- */
const getCustomerOutstanding = async (customerId) => {
  if (!mongoReady || !SaleModel) throw new Error('MongoDB no inicializado');

  const match = {};
  if (typeof customerId === 'string' && isObjectId(customerId)) match.customerRef = mongoose.Types.ObjectId(customerId);
  else if (!isNaN(Number(customerId))) match.oldCustomerId = Number(customerId);
  else match.customerRef = customerId;

  const agg = await SaleModel.aggregate([
    { $match: { ...match, on_credit: true, outstanding_amount: { $gt: 0 } } },
    { $group: { _id: null, total_outstanding: { $sum: '$outstanding_amount' }, pending_sales: { $sum: 1 } } }
  ]).exec();

  const row = agg && agg[0] ? agg[0] : null;
  return {
    total_outstanding: Number(row?.total_outstanding || 0),
    pending_sales: Number(row?.pending_sales || 0)
  };
};

/* ---------- deleteSalesByCustomerId ---------- */
const deleteSalesByCustomerId = async (customerId) => {
  if (!mongoReady || !SaleModel) throw new Error('MongoDB no inicializado');

  const filter = {};
  if (typeof customerId === 'string' && isObjectId(customerId)) filter.customerRef = mongoose.Types.ObjectId(customerId);
  else if (!isNaN(Number(customerId))) filter.oldCustomerId = Number(customerId);
  else filter.customerRef = customerId;

  const res = await SaleModel.deleteMany(filter).exec();
  return res.deletedCount;
};

module.exports = {
  init,
  createSale,
  listSales,
  getSaleById,
  updateSalePayment,
  getCustomerOutstanding,
  deleteSalesByCustomerId
};