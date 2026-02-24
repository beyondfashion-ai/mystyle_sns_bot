import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Initialize Firebase Admin SDK
// You must set the path to your service account key file in your .env
// e.g. FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./service-account.json
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;

if (!serviceAccountPath) {
  console.warn("FIREBASE_SERVICE_ACCOUNT_KEY_PATH is not set in .env.");
} else if (!fs.existsSync(serviceAccountPath)) {
  console.warn(`Service account key not found at ${serviceAccountPath}`);
} else {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined,
    });
    console.log("Firebase Admin SDK initialized successfully.");
  } catch (error) {
    console.error("Error initializing Firebase Admin SDK:", error);
  }
}

export const db = admin.apps.length ? admin.firestore() : null;
