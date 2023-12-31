const express = require('express');
const router = express.Router();
const {
  createMealPlan,
  updateMealPlan,
  getAllMealPlan,
  deleteMealPlan,
} = require('../controllers/mealPlanner_controller');

router.get('/', getAllMealPlan);
router.post('/', createMealPlan);
router.put('/:id', updateMealPlan);
router.delete('/:id', deleteMealPlan);

module.exports = router;
