// src/controllers/productosController.js
const productoService = require('../services/productosService');

const listar = async (req, res) => {
  try {
    const { categoria, marca } = req.query;
    const productos = await productoService.listarProductos({ categoria, marca });
    res.json(productos);
  } catch (err) {
    console.error('[productosController.listar]', err);
    res.status(500).json({ message: 'Error al listar productos' });
  }
};

const crear = async (req, res) => {
  try {
    const payload = req.body || {};

    if (!payload.nombre || String(payload.nombre).trim() === '') {
      return res.status(400).json({ message: 'El nombre es requerido' });
    }

    // Validaciones simples para crear
    if (payload.precio != null && isNaN(Number(payload.precio))) {
      return res.status(400).json({ message: 'Precio inválido' });
    }
    if (payload.stock != null && (!Number.isInteger(Number(payload.stock)) || Number(payload.stock) < 0)) {
      return res.status(400).json({ message: 'Stock inválido' });
    }
    if (payload.cost != null && isNaN(Number(payload.cost))) {
      return res.status(400).json({ message: 'Costo inválido' });
    }

    const toSave = {
      nombre: payload.nombre,
      marca: payload.marca || null,
      descripcion: payload.descripcion || null,
      precio: payload.precio == null ? null : Number(payload.precio),
      categoria: payload.categoria || null,
      imagen: payload.imagen || null,
      vencimiento: payload.vencimiento || null,
      stock: payload.stock == null ? null : Number(payload.stock),
      cost: payload.cost == null ? 0 : Number(payload.cost),
    };

    const nuevo = await productoService.crearProducto(toSave);
    res.status(201).json(nuevo);
  } catch (err) {
    console.error('[productosController.crear]', err);
    res.status(500).json({ message: 'Error al crear producto' });
  }
};

const actualizar = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await productoService.obtenerProductoPorId(id);
    if (!existing) return res.status(404).json({ message: 'Producto no encontrado' });

    const payload = req.body || {};

    // Validaciones sólo si el campo viene en el payload
    if (payload.hasOwnProperty('precio')) {
      if (payload.precio != null && isNaN(Number(payload.precio))) {
        return res.status(400).json({ message: 'Precio inválido' });
      }
    }
    if (payload.hasOwnProperty('stock')) {
      if (payload.stock != null && (!Number.isInteger(Number(payload.stock)) || Number(payload.stock) < 0)) {
        return res.status(400).json({ message: 'Stock inválido' });
      }
    }
    if (payload.hasOwnProperty('cost')) {
      if (payload.cost != null && isNaN(Number(payload.cost))) {
        return res.status(400).json({ message: 'Costo inválido' });
      }
    }

    // Construir objeto toSave sólo con campos presentes en la request
    const toSave = {};
    if (payload.hasOwnProperty('nombre')) toSave.nombre = payload.nombre;
    if (payload.hasOwnProperty('marca')) toSave.marca = payload.marca;
    if (payload.hasOwnProperty('descripcion')) toSave.descripcion = payload.descripcion;
    if (payload.hasOwnProperty('precio')) toSave.precio = payload.precio == null ? null : Number(payload.precio);
    if (payload.hasOwnProperty('categoria')) toSave.categoria = payload.categoria;
    if (payload.hasOwnProperty('imagen')) toSave.imagen = payload.imagen;
    if (payload.hasOwnProperty('vencimiento')) {
      // si mandan '' lo convertimos a null, opcional
      toSave.vencimiento = payload.vencimiento === '' ? null : payload.vencimiento;
    }
    if (payload.hasOwnProperty('stock')) toSave.stock = payload.stock == null ? null : Number(payload.stock);
    if (payload.hasOwnProperty('cost')) toSave.cost = payload.cost == null ? 0 : Number(payload.cost);

    // Llamar al service (que ya respeta actualizar parcial)
    const actualizado = await productoService.actualizarProducto(id, toSave);
    res.json(actualizado);
  } catch (err) {
    console.error('[productosController.actualizar]', err);
    res.status(500).json({ message: 'Error al actualizar producto' });
  }
};

const eliminar = async (req, res) => {
  try {
    const { id } = req.params;
    const producto = await productoService.obtenerProductoPorId(id);
    
    if (!producto) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }

    await productoService.eliminarProducto(id);
    res.status(200).json({ message: 'Producto eliminado correctamente' });
  } catch (err) {
    console.error('[productosController.eliminar]', err);
    res.status(500).json({ message: 'Error al eliminar producto' });
  }
};

module.exports = { listar, crear, actualizar, eliminar };