/* OpenAI API */
const Recipe = require('../models/Recipe');
const { StatusCodes } = require('http-status-codes');
const { BadRequestError } = require('../errors');
const asyncWrapper = require('../middleware/async');
const transformRecipeData = require('../helpers/transformRecipeData');
const myRecipePrompt = require('../prompts/recipePrompt');
const generateImagePrompt = require('../prompts/generateImagePrompt');
const cloudinary = require('cloudinary');
const fs = require('fs').promises;

const DEFAULT_IMAGE_URL =
  'https://res.cloudinary.com/djidbbhk1/image/upload/v1693072469/default_image_lv6ume.png';

const DEFAULT_PUBLIC_ID = 'default_image_lv6ume';

const fetchAiRecipe = async (req, res) => {
  const { query, optionValues } = req.body;
  const optValue = optionValues.length > 0 ? optionValues.join(', ') : '';

  if (!query || query.trim() === '') {
    throw new BadRequestError('Please provide a query.');
  }
  const assistant = `You are a helpful assistant that generates delicious recipes for various ingredients. Your goal is to provide unique recipes based on user input, considering specific ingredients, dietary preferences, or cuisine types that are safe for human consumption. Please do not provide recipes that are poisonous, such as fly agaric. Please note that you can only answer recipe-related queries. If you cannot find a relevant meaning in the presented text, please ask the user to try re-phrasing the question.`;
  const options = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: assistant },
        {
          role: 'user',
          content: `User receives a recipe based on following ingredient: ${query}. Preferences or Dietaries:${optValue}`,
        },
      ],
      temperature: 0.4,
      max_tokens: 750,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      functions: [myRecipePrompt],
    }),
  };
  try {
    const response = await fetch(
      'https://api.openai.com/v1/chat/completions',
      options
    );
    const { choices } = await response.json();
    const data = JSON.parse(choices[0].message.function_call.arguments);

    // Call the generateImagePrompt for data
    const imageGenerationPrompt = generateImagePrompt(data);
    // Use Bing Image Search API to search for images related to the recipe
    const bingImageOptions = {
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.BING_IMAGE_SEARCH_API_KEY,
      },
    };
    // Define the desired height (in pixels)
    // const desiredHeight = 150;
    const sizeFilter = 'medium';

    const endPointToGenerateImg = `https://api.bing.microsoft.com/v7.0/images/search?q=${encodeURIComponent(
      imageGenerationPrompt
    )}&size=${sizeFilter}`;

    const bingImageResponse = await fetch(
      endPointToGenerateImg,
      bingImageOptions
    );

    const bingImageData = await bingImageResponse.json();
    const imageUrl =
      bingImageData.value && bingImageData.value.length > 0
        ? bingImageData.value[0].contentUrl
        : '';
    const responseData = {
      ...data,
      image: imageUrl,
    };
    res.status(StatusCodes.OK).send(responseData);
  } catch (err) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: 'Failed to generate the recipe.' });
  }
};

// Create a new AI recipe
const createAiRecipe = asyncWrapper(async (req, res) => {
  const recipeData = transformRecipeData(req.body);
  recipeData.recipeCreatedBy = req.user.userId;
  const newRecipe = await Recipe.create(recipeData);
  res
    .status(StatusCodes.CREATED)
    .json({ data: newRecipe, message: 'Recipe created successfully' });
});

// Create a new manual recipe
const createManualRecipe = asyncWrapper(async (req, res) => {
  const manualRecipeData = { ...req.body }; // shallow copy of object using spread operator.
  // Set the recipe's creator to the authenticated user's ID
  manualRecipeData.recipeCreatedBy = req.user.userId;
  try {
    //if there is no uploaded file by user, upload default image
    let imageResponse = {};
    if (!req.file) {
      imageResponse.secure_url = DEFAULT_IMAGE_URL;
      imageResponse.public_id = DEFAULT_PUBLIC_ID;
    } else {
      // If there's an uploaded image, associate its path with the recipe
      imageResponse = await cloudinary.v2.uploader.upload(req.file.path);
      await fs.unlink(req.file.path);
    }
    manualRecipeData.recipeImage = imageResponse.secure_url;
    manualRecipeData.recipeImagePublic = imageResponse.public_id;
    // Create a new recipe using the data from the request body
    const recipe = await Recipe.create(manualRecipeData);

    res.status(StatusCodes.CREATED).json({ recipe });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: 'Error uploading image or creating recipe' });
  }
});

// Get all recipes created by the authenticated user and sort them by creation date
const getAllRecipes = asyncWrapper(async (req, res) => {
  const recipes = await Recipe.find({ recipeCreatedBy: req.user.userId }).sort(
    'createdAt'
  );
  res.status(StatusCodes.OK).json({ recipes, count: recipes.length });
});

// Get a specific saved recipe by its ID
const getRecipe = asyncWrapper(async (req, res) => {
  const {
    user: { userId },
    params: { recipeId },
  } = req;

  // Find a recipe with the recipe ID created by the auth user
  try {
    const recipe = await Recipe.findOne({
      _id: recipeId,
      recipeCreatedBy: userId,
    });

    if (!recipe) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ message: 'Recipe not found' });
    }

    res.status(StatusCodes.OK).json(recipe);
  } catch (error) {
    console.error(error); // Log the error for debugging purposes
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: 'Error retrieving recipe', error: error.message });
  }
});

const updateRecipe = async (req, res) => {
  const { recipeId } = req.params;
  const { userId } = req.user;
  const newRecipe = { ...req.body };

  try {
    const recipe = await Recipe.findOne({
      _id: recipeId,
      recipeCreatedBy: userId,
    });

    if (!recipe) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ message: 'Recipe not found' });
    }
    let oldRecipeImgPublicId = null;

    // Handle image upload to Cloudinary
    if (req.file) {
      const response = await cloudinary.v2.uploader.upload(req.file.path);
      // Delete the temporarily uploaded file from public/upload folder
      await fs.unlink(req.file.path);
      newRecipe.recipeImage = response.secure_url;
      newRecipe.recipeImagePublic = response.public_id;
      oldRecipeImgPublicId = recipe.recipeImagePublic;
    }

    if ('recipeTags' in newRecipe) {
      if (newRecipe.recipeTags.length === 0) {
        recipe.recipeTags = [];
      } else {
        recipe.recipeTags = newRecipe.recipeTags;
      }
    }

    if ('recipeSpecialDiets' in newRecipe) {
      if (newRecipe.recipeSpecialDiets.length === 0) {
        recipe.recipeSpecialDiets = [];
      } else {
        recipe.recipeSpecialDiets = newRecipe.recipeSpecialDiets;
      }
    }
    // Update other fields without overwriting recipeTags and recipeSpecialDiets
    delete newRecipe.recipeTags;
    delete newRecipe.recipeSpecialDiets;
    // Update text fields
    Object.assign(recipe, newRecipe);

    // Save the updated recipe to MongoDB
    const updatedRecipe = await recipe.save();

    // Delete the old image from Cloudinary
    if (oldRecipeImgPublicId) {
      await cloudinary.v2.uploader.destroy(oldRecipeImgPublicId);
    }

    res.status(StatusCodes.OK).json(updatedRecipe);
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: 'Error updating recipe', error: error.message });
  }
};

// Delete a saved recipe
const deleteRecipe = asyncWrapper(async (req, res) => {
  const {
    user: { userId },
    params: { recipeId },
  } = req;

  // Find and delete the recipe with the recipe ID created by the user
  try {
    const deletedRecipe = await Recipe.findOneAndDelete({
      _id: recipeId,
      recipeCreatedBy: userId,
    });

    if (!deletedRecipe) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ message: 'Recipe not found' });
    }

    res.status(StatusCodes.OK).json({ message: 'Recipe deleted successfully' });
  } catch (error) {
    console.error(error); // Log the error for debugging purposes
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: 'Error deleting recipe', error: error.message });
  }
});

module.exports = {
  fetchAiRecipe,
  createAiRecipe,
  createManualRecipe,
  getAllRecipes,
  getRecipe,
  updateRecipe,
  deleteRecipe,
};
