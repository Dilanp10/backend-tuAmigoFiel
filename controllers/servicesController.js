// src/controllers/servicesController.js
const servicesService = require('../services/servicesService');

const listar = async (req, res) => {
  try {
    const services = await servicesService.listServices();
    res.json(services);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const crear = async (req, res) => {
  try {
    const { nombre, descripcion, precio, duracion_min, categoria, activo } = req.body;
    
    const newService = await servicesService.createService({
      nombre, 
      descripcion, 
      precio, 
      duracion_min, 
      categoria, 
      activo
    });
    
    res.status(201).json(newService);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const detalle = async (req, res) => {
  try {
    const { id } = req.params;
    const service = await servicesService.getServiceById(id);
    
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

    const updatedService = await servicesService.updateService(id, {
      nombre, descripcion, precio, duracion_min, categoria, activo
    });
    
    res.json(updatedService);
  } catch (error) {
    console.error('Error al actualizar servicio:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

const eliminar = async (req, res) => {
  try {
    const { id } = req.params;
    
    await servicesService.deleteService(id);
    res.status(200).json({ message: 'Servicio eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar servicio:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

module.exports = {
  listar,
  crear,
  detalle,
  actualizar,
  eliminar 
};

