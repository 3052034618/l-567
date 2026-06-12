const FishSpecies = require('../models/FishSpecies');

const getFishSpecies = async (req, res, next) => {
  try {
    const { isActive, page = 1, limit = 10, keyword } = req.query;
    
    const query = {};
    
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (keyword) {
      query.$or = [
        { name: { $regex: keyword, $options: 'i' } },
        { scientificName: { $regex: keyword, $options: 'i' } }
      ];
    }
    
    const species = await FishSpecies.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });
    
    const total = await FishSpecies.countDocuments(query);
    
    res.json({
      success: true,
      data: species,
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

const getFishSpeciesById = async (req, res, next) => {
  try {
    const species = await FishSpecies.findById(req.params.id);
    
    if (!species) {
      return res.status(404).json({ message: '鱼种不存在' });
    }
    
    res.json({
      success: true,
      data: species
    });
  } catch (error) {
    next(error);
  }
};

const createFishSpecies = async (req, res, next) => {
  try {
    const species = new FishSpecies(req.body);
    await species.save();
    
    res.status(201).json({
      success: true,
      data: species
    });
  } catch (error) {
    next(error);
  }
};

const updateFishSpecies = async (req, res, next) => {
  try {
    const species = await FishSpecies.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!species) {
      return res.status(404).json({ message: '鱼种不存在' });
    }
    
    res.json({
      success: true,
      data: species
    });
  } catch (error) {
    next(error);
  }
};

const deleteFishSpecies = async (req, res, next) => {
  try {
    const species = await FishSpecies.findByIdAndDelete(req.params.id);
    
    if (!species) {
      return res.status(404).json({ message: '鱼种不存在' });
    }
    
    res.json({
      success: true,
      message: '鱼种已删除'
    });
  } catch (error) {
    next(error);
  }
};

const getGrowthStage = (species, daysSinceStock) => {
  if (!species.growthStages || species.growthStages.length === 0) {
    return null;
  }
  
  let currentStage = species.growthStages[0];
  let accumulatedDays = 0;
  
  for (const stage of species.growthStages) {
    accumulatedDays += stage.days;
    if (daysSinceStock <= accumulatedDays) {
      currentStage = stage;
      break;
    }
    currentStage = stage;
  }
  
  return currentStage;
};

const calculateOptimalThresholds = (species, growthStage) => {
  const tempAdjust = growthStage?.temperatureAdjustment || 0;
  const oxygenAdjust = growthStage?.oxygenAdjustment || 0;
  
  return {
    temperatureMin: species.optimalTemperature.min + tempAdjust,
    temperatureMax: species.optimalTemperature.max + tempAdjust,
    oxygenMin: species.optimalOxygen.min + oxygenAdjust,
    phMin: species.optimalPH.min,
    phMax: species.optimalPH.max
  };
};

module.exports = {
  getFishSpecies,
  getFishSpeciesById,
  createFishSpecies,
  updateFishSpecies,
  deleteFishSpecies,
  getGrowthStage,
  calculateOptimalThresholds
};
