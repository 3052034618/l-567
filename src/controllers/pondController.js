const Pond = require('../models/Pond');
const FishSpecies = require('../models/FishSpecies');
const { getGrowthStage, calculateOptimalThresholds } = require('./fishSpeciesController');

const getPonds = async (req, res, next) => {
  try {
    const { status, fishSpecies, page = 1, limit = 10, keyword } = req.query;
    
    const query = {};
    
    if (status) query.status = status;
    if (fishSpecies) query.fishSpecies = fishSpecies;
    if (keyword) {
      query.$or = [
        { pondNo: { $regex: keyword, $options: 'i' } },
        { name: { $regex: keyword, $options: 'i' } }
      ];
    }
    
    const ponds = await Pond.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ pondNo: 1 })
      .populate('fishSpecies', 'name')
      .populate('assignedWorker', 'realName phone');
    
    const total = await Pond.countDocuments(query);
    
    res.json({
      success: true,
      data: ponds,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

const getPondById = async (req, res, next) => {
  try {
    const pond = await Pond.findById(req.params.id)
      .populate('fishSpecies')
      .populate('assignedWorker', 'realName phone role')
      .populate('devices');
    
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    res.json({
      success: true,
      data: pond
    });
  } catch (error) {
    next(error);
  }
};

const createPond = async (req, res, next) => {
  try {
    const { pondNo, name, area, depth, fishSpecies, stockDate, initialStockCount, averageWeight, location, assignedWorker } = req.body;
    
    const volume = area * depth;
    
    const species = await FishSpecies.findById(fishSpecies);
    if (!species) {
      return res.status(400).json({ message: '鱼种不存在' });
    }
    
    const daysSinceStock = Math.floor((Date.now() - new Date(stockDate)) / (1000 * 60 * 60 * 24));
    const growthStage = getGrowthStage(species, daysSinceStock);
    const thresholds = calculateOptimalThresholds(species, growthStage);
    
    const pond = new Pond({
      pondNo,
      name,
      area,
      depth,
      volume,
      fishSpecies,
      stockDate,
      initialStockCount,
      currentStockCount: initialStockCount,
      averageWeight: averageWeight || 0,
      location,
      assignedWorker,
      thresholds,
      growthStage: growthStage?.name
    });
    
    await pond.save();
    
    res.status(201).json({
      success: true,
      data: pond
    });
  } catch (error) {
    next(error);
  }
};

const updatePond = async (req, res, next) => {
  try {
    const pond = await Pond.findById(req.params.id);
    
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    const { area, depth, fishSpecies, stockDate, currentStockCount, averageWeight } = req.body;
    
    if (area || depth) {
      pond.area = area || pond.area;
      pond.depth = depth || pond.depth;
      pond.volume = pond.area * pond.depth;
    }
    
    if (fishSpecies && fishSpecies !== pond.fishSpecies.toString()) {
      const species = await FishSpecies.findById(fishSpecies);
      if (!species) {
        return res.status(400).json({ message: '鱼种不存在' });
      }
      pond.fishSpecies = fishSpecies;
    }
    
    if (currentStockCount !== undefined) pond.currentStockCount = currentStockCount;
    if (averageWeight !== undefined) pond.averageWeight = averageWeight;
    
    if (req.body.name) pond.name = req.body.name;
    if (req.body.location) pond.location = req.body.location;
    if (req.body.assignedWorker !== undefined) pond.assignedWorker = req.body.assignedWorker;
    if (req.body.status) pond.status = req.body.status;
    if (req.body.notes !== undefined) pond.notes = req.body.notes;
    if (stockDate) pond.stockDate = stockDate;
    
    if (fishSpecies || stockDate || pond.fishSpecies) {
      const species = await FishSpecies.findById(pond.fishSpecies);
      if (species && pond.stockDate) {
        const daysSinceStock = Math.floor((Date.now() - new Date(pond.stockDate)) / (1000 * 60 * 60 * 24));
        const growthStage = getGrowthStage(species, daysSinceStock);
        pond.thresholds = calculateOptimalThresholds(species, growthStage);
        pond.growthStage = growthStage?.name;
      }
    }
    
    await pond.save();
    
    res.json({
      success: true,
      data: pond
    });
  } catch (error) {
    next(error);
  }
};

const deletePond = async (req, res, next) => {
  try {
    const pond = await Pond.findByIdAndDelete(req.params.id);
    
    if (!pond) {
      return res.status(404).json({ message: '养殖池不存在' });
    }
    
    res.json({
      success: true,
      message: '养殖池已删除'
    });
  } catch (error) {
    next(error);
  }
};

const getPondSummary = async (req, res, next) => {
  try {
    const totalPonds = await Pond.countDocuments();
    const normalPonds = await Pond.countDocuments({ status: 'normal' });
    const warningPonds = await Pond.countDocuments({ status: 'warning' });
    const criticalPonds = await Pond.countDocuments({ status: 'critical' });
    
    const allPonds = await Pond.find({}, 'currentWaterQuality totalBiomass currentStockCount');
    
    let totalBiomass = 0;
    let totalStock = 0;
    allPonds.forEach(pond => {
      totalBiomass += pond.totalBiomass || 0;
      totalStock += pond.currentStockCount || 0;
    });
    
    res.json({
      success: true,
      data: {
        totalPonds,
        normalPonds,
        warningPonds,
        criticalPonds,
        totalBiomass,
        totalStock
      }
    });
  } catch (error) {
    next(error);
  }
};

const updatePondThresholds = async (pondId) => {
  const pond = await Pond.findById(pondId).populate('fishSpecies');
  if (!pond || !pond.fishSpecies || !pond.stockDate) return;
  
  const daysSinceStock = Math.floor((Date.now() - new Date(pond.stockDate)) / (1000 * 60 * 60 * 24));
  const growthStage = getGrowthStage(pond.fishSpecies, daysSinceStock);
  const thresholds = calculateOptimalThresholds(pond.fishSpecies, growthStage);
  
  pond.thresholds = thresholds;
  pond.growthStage = growthStage?.name;
  await pond.save();
  
  return { pond, growthStage, thresholds };
};

module.exports = {
  getPonds,
  getPondById,
  createPond,
  updatePond,
  deletePond,
  getPondSummary,
  updatePondThresholds
};
