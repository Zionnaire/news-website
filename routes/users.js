const express = require("express");
const userRouter = express.Router();
const User = require("../models/users");
const bcrypt = require("bcryptjs");
const Role = require("../models/role");
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const cloudinary = require('cloudinary').v2;
const { signJwt, verifyToken } = require("../middlewares/jwt");
const { createLogger, transports, format } = require('winston');
const Content = require("../models/content")

// Configure Winston logger
const logger = createLogger({
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'error.log', level: 'error' }),
    new transports.File({ filename: 'combined.log' })
  ],
  format: format.combine(
    format.timestamp(),
    format.json()
  )
});



userRouter.post(
  '/register',
  [
    // Validation middleware
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('email').trim().isEmail().withMessage('Invalid email'),
    body('password').trim().isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    body('cPassword').custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Confirm password must match password');
      }
      return true;
    }),
    body('role').custom(async (value) => {
      const regularRole = await Role.findOne({ name: 'Regular' });
      if (!value || value !== regularRole.name) {
        throw new Error('Invalid role');
      }
      return true;
    })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { firstName, lastName, email, password, cPassword, role } = req.body;

      const userExist = await User.findOne({ email });
      if (userExist) {
        return res.status(409).json({ message: 'User with this email already exists' });
      }
      if(cPassword !== password){
        return res.json({message: "Confirm password must be same with password"});
      }

      const hashPassword = await bcrypt.hash(password, 10);
      const regularRole = await Role.findOne({ name: 'Regular' });
      const newUser = await User.create({
        firstName,
        lastName,
        email,
        password: hashPassword,
        roleId: regularRole._id, // Convert the ID to ObjectId
        role
      });
      

      return res.json({
        message: `User ${newUser.firstName} has been registered. Congratulations`,
        Id: newUser._id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        roleId: newUser.roleId,
        role: role
      });
    } catch (error) {
      // Handle the error appropriately
      console.error(error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }
);

userRouter.get('/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    // Find the user by ID in the database and populate the 'role' field
    const user = await User.findById(userId).populate('roleId');

    // Check if the user exists
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Return the user data with role name
    return res.json({
      Id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roleId: user.roleId,
      role: user.roleId.name, // Include the role name from the populated 'roleId'
    });
  }  catch (error) {
    // Handle the error appropriately
    console.error(error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

//Get all Users
userRouter.get('/', async (req, res) => {
  try {

    const users = await User.find()
    return res.json(users);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

let allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'];

// Update profile PUT request with image
userRouter.put(
  '/update-profile', verifyToken,
  [
    // Validation middleware for updating profile
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('email').trim().isEmail().withMessage('Invalid email'),
  body('password').optional().trim().isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  body('cPassword').custom((value, { req }) => {
    if (value && value !== req.body.password) {
      throw new Error('Confirm password must match password');
    }
    return true;
  }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { firstName, lastName, email, password } = req.body;
     // Extracting the first file from req.files
const files = Object.values(req.files); // Convert object to array
if (!files || files.length === 0) {
  return res.status(400).json({ message: 'No files uploaded' });
}

// Check each file for allowed types
const invalidFiles = files.filter(file => !allowedImageTypes.includes(file.mimetype));
if (invalidFiles.length > 0) {
  return res.status(400).json({ message: 'Invalid file type' });
}

// Assuming you have a user ID available in req.user.id after authentication
const userId = req.user.id;
const token = signJwt({ id: userId });

// Find the user by ID
const user = await User.findById(userId);
if (!user) {
  return res.status(404).json({ message: 'User not found' });
}

// Handle userImage from the request body
// Upload and update user image if provided
if (files && files.length > 0) {
  for (const file of files) {
    const randomId = Math.random().toString(36).substring(2);
    const imageFileName = randomId + file.name;
    const base64Image = `data:${file.mimetype};base64,${file.data.toString('base64')}`;

    try {
      const { secure_url: imageUrl, public_id: imageCldId } = await uploadToCloudinary(base64Image, `profile-images/${imageFileName}`);

      // Add the new image object to the userImage array
      user.userImage.push({
        url: imageUrl,
        cld_id: imageCldId,
      });
    } catch (error) {
      console.error('Error uploading image to Cloudinary:', error.message);
      return res.status(500).json({ message: 'Error uploading image to Cloudinary' });
    }
  }
}

// Save the updated user
await user.save();

return res.json({
  message: `User profile updated successfully`,
  userId: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  userImage: user.userImage,
  token,
});

} catch (error) {
  console.error(error);
  logger.error(error)
  return res.status(500).json({ message: 'Internal Server Error' });
}        
  }
);


// Assume you have a route to mark the start of content viewing
userRouter.post('/content/:userId/start', async (req, res) => {
  const userId = req.params.userId; // Assuming user ID is available after authentication
  const contentId = req.body.contentId; // Assuming content ID is sent in the request body

  // Find content
  const content = await Content.findById(contentId);
  if (!content) {
    return res.status(404).json({ message: 'content not found' });
  }

  try {
    // Save the current timestamp in the user's document (you should have a User model)
    const user = await User.findOneAndUpdate(
      { _id: userId },
      { $set: { contentStartTime: new Date() } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Log the content start time for debugging
    console.log('Content Start Time:', user.contentStartTime);

    return res.json({ message: 'Content viewing started', contentStartTime: user.contentStartTime });
  } catch (error) {
    console.error('Error in start API:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});





// Route to mark the end of content viewing
userRouter.post('/content/:userId/end', async (req, res) => {
  try {
    const userId = req.params.userId;
    const contentId = req.body.contentId;

    // Find content
    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }

    // Find the user and get the content start time
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const contentStartTime = user.contentStartTime;

    if (!contentStartTime) {
      return res.status(400).json({ message: 'Content start time not recorded' });
    }

    // Calculate the duration in minutes
    const currentTime = new Date();
    const durationInMinutes = (currentTime - new Date(contentStartTime)) / (1000 * 60);

    // Reward the user if the duration is at least one minute
    if (durationInMinutes >= 1) {
      const rewardPerContent = 0.12;
      // Update the rewardAmount
      user.rewardAmount += rewardPerContent;

      // Reset the contentStartTime
      user.contentStartTime = null;

      // Save the updated user document
      await user.save();

      return res.json({
        message: 'User rewarded successfully',
        userId: user._id,
        rewardAmount: user.rewardAmount,
      });
    } else {
      return res.status(400).json({ message: 'Duration must be at least one minute' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});



// Helper function to calculate the duration in minutes
function calculateDuration(startTime) {
  const endTime = new Date();
  const timeDifference = endTime - startTime; // in milliseconds
  const durationInMinutes = timeDifference / (1000 * 60); // convert to minutes
  return durationInMinutes;
}



// Helper function to upload image to Cloudinary
async function uploadToCloudinary(base64File, folder) {
  try {
    const { secure_url, public_id } = await cloudinary.uploader.upload(base64File, {folder});
    
    return { secure_url, public_id }
  } catch (error) {
    logger.error(error);
    console.error('Cloudinary Upload Error:', error);
    throw error;
  }
}




module.exports = userRouter;