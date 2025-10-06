// src/controllers/customersController.js
const customersService = require('../services/customersService');

const listar = async (req, res) => {
  try {
    const { q, limit, offset } = req.query;
    const rows = await customersService.listCustomers({ q, limit: limit || 200, offset: offset || 0 });
    res.json(rows);
  } catch (err) {
    console.error('[customersController.listar]', err);
    res.status(500).json({ message: 'Error al listar clientes' });
  }
};

const detalle = async (req, res) => {
  try {
    const { id } = req.params;
    const c = await customersService.getCustomerById(id);
    if (!c) return res.status(404).json({ message: 'Cliente no encontrado' });
    res.json(c);
  } catch (err) {
    console.error('[customersController.detalle]', err);
    res.status(500).json({ message: 'Error al obtener cliente' });
  }
};

const crear = async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.nombre || String(payload.nombre).trim() === '') {
      return res.status(400).json({ message: 'Nombre requerido' });
    }
    const created = await customersService.createCustomer(payload);
    res.status(201).json(created);
  } catch (err) {
    console.error('[customersController.crear]', err);
    res.status(500).json({ message: 'Error al crear cliente' });
  }
};

const actualizar = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await customersService.getCustomerById(id);
    if (!existing) return res.status(404).json({ message: 'Cliente no encontrado' });
    const updated = await customersService.updateCustomer(id, req.body || {});
    res.json(updated);
  } catch (err) {
    console.error('[customersController.actualizar]', err);
    res.status(500).json({ message: 'Error al actualizar cliente' });
  }
};

const eliminar = async (req, res) => {
  try {
    const { id } = req.params;
    const exists = await customersService.getCustomerById(id);
    if (!exists) return res.status(404).json({ message: 'Cliente no encontrado' });
    await customersService.deleteCustomer(id);
    res.json({ message: 'Cliente eliminado' });
  } catch (err) {
    console.error('[customersController.eliminar]', err);
    res.status(500).json({ message: 'Error al eliminar cliente' });
  }
};

module.exports = { listar, detalle, crear, actualizar, eliminar };