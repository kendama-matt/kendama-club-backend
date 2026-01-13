require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['https://kendama.club', 'https://www.kendama.club', 'https://kendama-club-site.vercel.app', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-access-password']
}));
app.use(express.json());

// Password protection middleware
const checkPassword = (req, res, next) => {
  const password = req.headers['x-access-password'] || req.query.password;

  if (password !== process.env.ACCESS_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  next();
};

// Initialize Backblaze B2 (S3-compatible)
const s3Client = new S3Client({
  endpoint: `https://${process.env.B2_ENDPOINT}`,
  region: process.env.B2_REGION,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY,
  },
});

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Generate presigned URL for upload
app.post('/api/upload-url', checkPassword, async (req, res) => {
  try {
    const { filename, contentType } = req.body;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType are required' });
    }

    // Generate unique filename to avoid collisions
    const uniqueFilename = `${uuidv4()}-${filename}`;

    const command = new PutObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME,
      Key: uniqueFilename,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    res.json({ uploadUrl, filename: uniqueFilename });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// Save video metadata to Supabase
app.post('/api/videos', checkPassword, async (req, res) => {
  try {
    const { filename, original_name, file_size, description, event_name } = req.body;

    if (!filename || !original_name) {
      return res.status(400).json({ error: 'filename and original_name are required' });
    }

    const { data, error } = await supabase
      .from('videos')
      .insert([
        {
          filename,
          original_name,
          file_size,
          description,
          event_name,
        },
      ])
      .select();

    if (error) {
      throw error;
    }

    res.json(data[0]);
  } catch (error) {
    console.error('Error saving video metadata:', error);
    res.status(500).json({ error: 'Failed to save video metadata' });
  }
});

// Get all videos
app.get('/api/videos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .order('uploaded_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// Generate presigned URL for download
app.get('/api/download-url/:filename', checkPassword, async (req, res) => {
  try {
    const { filename } = req.params;

    const command = new GetObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME,
      Key: filename,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    res.json({ downloadUrl });
  } catch (error) {
    console.error('Error generating download URL:', error);
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Only listen when running locally (not on Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export for Vercel
module.exports = app;
