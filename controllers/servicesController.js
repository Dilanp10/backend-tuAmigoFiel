// src/controllers/servicesController.js
const { all, get, run } = require('../config/db'); // ← IMPORTAR CORRECTAMENTE

const listar = async (req, res) => {
  try {
    const services = await all('SELECT * FROM services');
    res.json(services);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const crear = async (req, res) => {
  try {
    const { nombre, descripcion, precio, duracion_min, categoria, activo } = req.body;
    
    const result = await run(
      'INSERT INTO services (nombre, descripcion, precio, duracion_min, categoria, activo) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, descripcion, precio, duracion_min, categoria, activo]
    );
    
    const newService = await get('SELECT * FROM services WHERE id = ?', [result.lastID]);
    res.status(201).json(newService);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const detalle = async (req, res) => {
  try {
    const { id } = req.params;
    const service = await get('SELECT * FROM services WHERE id = ?', [id]);
    
    if (!service) {
      return res.status(404).json({ message: 'Servicio no encontrado' });
    }
    
    res.json(service);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const actualizar = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion, precio, duracion_min, categoria, activo } = req.body;

    // Verificar que el servicio existe
    const servicioExistente = await get('SELECT * FROM services WHERE id = ?', [id]);
    if (!servicioExistente) {
      return res.status(404).json({ message: 'Servicio no encontrado' });
    }

    // Actualizar el servicio
    await run(
      `UPDATE services 
       SET nombre = ?, descripcion = ?, precio = ?, duracion_min = ?, categoria = ?, activo = ? 
       WHERE id = ?`,
      [nombre, descripcion, precio, duracion_min, categoria, activo, id]
    );

    // Obtener el servicio actualizado
    const servicioActualizado = await get('SELECT * FROM services WHERE id = ?', [id]);
    res.json(servicioActualizado);
  } catch (error) {
    console.error('Error al actualizar servicio:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

const eliminar = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que el servicio existe
    const servicioExistente = await get('SELECT * FROM services WHERE id = ?', [id]);
    if (!servicioExistente) {
      return res.status(404).json({ message: 'Servicio no encontrado' });
    }

    // Eliminar el servicio
    await run('DELETE FROM services WHERE id = ?', [id]);
    
    res.status(200).json({ message: 'Servicio eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar servicio:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// No olvides exportar todas las funciones
module.exports = {
  listar,
  crear,
  detalle,
  actualizar,
  eliminar 
};