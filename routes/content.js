const express = require('express');
const  Content  = require('../models/content'); // Update the path to your models file
const Comment = require('../models/comment');
const Reply = require('../models/reply')
const Admin = require('../models/admin')
const { signJwt, verifyToken } = require("../middlewares/jwt");
const { createLogger, transports, format } = require('winston');
const SuperAdmin = require('../models/superAdmin');
const contentRouter = express.Router();
const cloudinary = require('cloudinary').v2

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

const randomId =
  "_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

// Get all Contents 
contentRouter.get("/", async (req, res) => {
  try {
    const content = await Content.find({});
    return res.status(200).json({ success: true, data: content });
  } catch (error) {
    return res.json({
      success: false,
      message: error.message,
    });
  }
}); 

const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf', 'image/svg+xml'];
const allowedVideoTypes = ['video/mp4', 'audio/mpeg', 'audio/mp3'];

//Get Content by Certain Parameters
contentRouter.get('/', async (req, res) => {
  try {
    const { author, date, title } = req.query;
  
    let filter = {};
  
    // Check if a content by the specified author exists
    if (author) {
      const existingContent = await Content.findOne({ author });
  
      if (!existingContent) {
        return res.status(404).json({ message: 'Content not found' });
      }
  
      filter.author = author;
    }
  
    // Filter by date
    if (date) {
      filter.createdAt = { $gte: new Date(date) };
    }
  
    // Filter by title (case-insensitive)
    if (title) {
      filter.title = { $regex: new RegExp(title, 'i') };
    }
  
    const contents = await Content.find(filter)
      .populate('comments')
      .populate('likes');
  
    res.json(contents);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

//Create Contents

contentRouter.post('/contents', verifyToken, async (req, res) => {
  try {
    
    const { body, title, category, isAdmin } = req.body;
    const files = Object.values(req.files); // Convert object to array

    if (!files || files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const maxFilesPerType = 2; // Set the maximum number of files per type

    if (files.length > maxFilesPerType * 2) {
      return res.status(400).json({ message: `Exceeded the maximum number of files allowed (${maxFilesPerType} images + ${maxFilesPerType} videos)` });
    }

    // Separate files into images and videos
    const images = [];
    const videos = [];

    files.forEach(file => {
      if (allowedImageTypes.includes(file.mimetype)) {
        images.push(file);
      } else if (allowedVideoTypes.includes(file.mimetype)) {
        videos.push(file);
      }
    });
 

    // Check if a content with the same title and category already exists
    const existingContent = await Content.findOne({ title, category });

    if (existingContent) {
      return res.status(409).json({ message: 'Content with the same title already exists', action: 'update' });
    }
  
    const document = {
      title,
      category,
      images: [],
      videos:[],
      author:req.user.userName,
      body,
    }


    for (const image of images) {
  if (image && image.mimetype && image.data) {
    const randomId = Math.random().toString(36).substring(2);
    const imageFileName = randomId + image.name;
    // console.log(imageFileName);
    const base64Image = `data:${image.mimetype};base64,${image.data.toString('base64')}`;

    try {
      const { secure_url: imageUrl, public_id: imageCldId } = await uploadToCloudinary(base64Image, `contents/images/${imageFileName}`);
      document.images.push({ url: imageUrl, cld_id: imageCldId });
    } catch (error) {
      console.error('Content Error:', error.message);
      return res.status(500).json({ message: 'Error uploading image to Cloudinary' });
    }
  }
}

for (const video of videos) {
  if (video && video.mimetype && video.data) {
    const randomId = Math.random().toString(36).substring(2);
    const videoFileName = randomId + video.name;
    // console.log(videoFileName);
    const base64Video = `data:${video.mimetype};base64,${video.data.toString('base64')}`;
    
    try {
      const { videoUrl, videoCldId } = await uploadVideoToCloudinary(base64Video, `contents/videos/${videoFileName}`);
      document.videos.push({ url: videoUrl, cld_id: videoCldId });
    } catch (error) {
      console.error('Content Error:', error.message);
      return res.status(500).json({ message: error.message });
    }
  }
}
await createContent(document, req, res);

  } catch (error) {
    logger.error(error)
    console.error('Content Error:', error.message);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});
//Cloudinary File Upload
const uploadVideoToCloudinary = async (base64Video, folderPath) => {
  try {
    const { secure_url: videoUrl, public_id: videoCldId } = await cloudinary.uploader.upload(base64Video, {
      resource_type: "video",
      folder: folderPath,
    });
    return { videoUrl, videoCldId };
  } catch (error) {
    throw new Error(`Error uploading video to Cloudinary: ${error.message}`);
  }
};

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

async function createContent(document, req, res) {
  try {
    const userId = req.user.id;
    const adminExist = await Admin.findById(userId);
    const superAdminExist = await SuperAdmin.findById(userId);

    if (!adminExist && !superAdminExist) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    const role = adminExist ? adminExist.role : superAdminExist.role;
    const email = adminExist ? adminExist.email : superAdminExist.email;

    const token = signJwt({ id: userId, role, email });

    const content = await Content.create(document);
    content.publishedStatus = 'Published';

    res.status(200).json({
      success: true,
      message: 'Upload success',
      data: { ...content._doc }, // Include the author in the response
      token,
    });
  } catch (error) {
    res.json({
      success: false,
      message: error.message,
    });
  }
}

// Get a specific content by ID
contentRouter.get('/contents/:id', async (req, res) => {
  try {
    const content = await Content.findById(req.query.id).populate('comments');
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }
    res.json(content);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Update a specific content by ID
contentRouter.put('/contents/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Find the content by ID
    const content = await Content.findById(req.query.id);

    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }

    // Check if the authenticated user is the owner of the content
    if (content.userId.toString() !== userId) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    // Update the content
    const updatedContent = await Content.findByIdAndUpdate(
      req.query.id,
      req.body,
      { new: true }
    );

    res.json(updatedContent);
  } catch (error) {
    logger.error('Content Update Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


contentRouter.post('/:id/make-premium', async (req, res) => {
  try {
    const contentId = req.params.id;
     // Get the content ID from the URL parameter
    const { isPremium } = req.body; // Get the isPremium value from the request body

    // Find the content by ID
    const content = await Content.findById(contentId);

    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }

    // Update the isPremium field
    content.isPremium = isPremium;

    // Save the updated content
    await content.save();

    res.status(200).json({ message: 'Content is now premium' });
  } catch (error) {
    console.error('Content Error:', error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


// Delete a specific content by ID
contentRouter.delete('/contents', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const adminExist = await Admin.findById(userId);
    const superAdminExist = await SuperAdmin.findById(userId);

    if (!adminExist && !superAdminExist) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    const role = adminExist ? adminExist.role : superAdminExist.role;
    const email = adminExist ? adminExist.email : superAdminExist.email;

    const token = signJwt({ id: userId, role, email });

    if (!token) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    // const content = await Content.findByIdAndDelete(req.params._id)

    const content = await Content.findOne({_id: req.query.id})
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }
    await Content.deleteOne({_id: req.query.id})
    // Also delete associated comments
    await Comment.deleteMany({ _id: { $in: content.comments } });
    res.json({ message: 'Content deleted successfully' });
  } catch (error) {
    logger.error(error); // Log the error to the console
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Delete a specific content by Author and Title
contentRouter.delete('/contents/:author/:title', verifyToken, async (req, res) => {
  try {
    const { author, title } = req.params;
    const userId = req.user.id;

    const user = await Admin.findById(userId) || await SuperAdmin.findById(userId);

    if (!user) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    const { role, email } = user;
    const token = signJwt({ id: userId, role, email });

    if (!token) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    const content = await Content.findOneAndDelete({ author, title });

    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }

    // Also delete associated comments
    await Comment.deleteMany({ _id: { $in: content.comments } });

    res.json({ message: 'Content deleted successfully' });
  } catch (error) {
    console.error(error); // Log the error to the console
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Add a comment to a specific content
contentRouter.post('/contents/:id/comments',  async (req, res) => {
  try {
    const content = await Content.findById(req.query.id);
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }
    const newComment = await Comment.create(req.body);
    content.comments.push(newComment);
    await content.save();
    res.status(201).json(newComment);
  } catch (error) {
    logger.error(error); // Log the error to the console
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Like a specific content
contentRouter.post('/contents/:id/like', async (req, res) => {
  try {
    const content = await Content.findById(req.query.id);
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }
    content.likes.push(req.body.userId);
    await content.save();
    res.json({ message: 'Content liked successfully' });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Increment view count of a specific content
contentRouter.post('/contents/:id/increment-views', async (req, res) => {
  try {
    const content = await Content.findById(req.query.id);
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }
    content.views += 1;
    await content.save();
    res.json({ message: 'View count incremented successfully' });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Create a reply for a specific comment
contentRouter.post('/contents/:contentId/comments/:commentId/replies', async (req, res) => {
  try {
    const content = await Content.findById(req.query.contentId);
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }

    const comment = await Comment.findById(req.query.commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    const { author, body } = req.body;

    // Create the new reply
    const newReply = await Reply.create({
      comment: comment._id,
      author,
      body,
    });

    // Add the reply ID to the comment's replies array
    comment.replies.push(newReply._id);

    // Save the updated comment
    await comment.save();

    res.status(201).json(newReply);
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Delete a specific reply by ID
contentRouter.delete('/contents/:contentId/comments/:commentId/replies/:replyId', async (req, res) => {
  try {
    const content = await Content.findById(req.query.contentId);
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }

    const comment = await Comment.findById(req.query.commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    const reply = await Reply.findById(req.query.replyId);
    if (!reply) {
      return res.status(404).json({ message: 'Reply not found' });
    }

    // Check if the user deleting the reply is the reply's author
    if (reply.author.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Remove the reply ID from the comment's replies array
    comment.replies = comment.replies.filter((r) => r.toString() !== req.params.replyId);

    // Save the updated comment
    await comment.save();

    // Delete the reply from the database
    await reply.remove();

    res.json({ message: 'Reply deleted successfully' });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


module.exports = contentRouter;
