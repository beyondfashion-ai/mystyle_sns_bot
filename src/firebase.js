import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

if (fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' });
} else {
  dotenv.config();
}

// Initialize Firebase Admin SDK
// You must set the path to your service account key file in your .env
// e.g. FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./service-account.json
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;

const disabledFeatures = [
  'Firestore 게시물 분석 (analytics)',
  'DB 동적 포맷 저장/조회 (formatManager)',
  'Firebase Storage 이미지 호스팅 (cardNews)',
];

if (!serviceAccountPath) {
  console.warn('[Firebase] FIREBASE_SERVICE_ACCOUNT_KEY_PATH 미설정. 비활성화 기능:');
  disabledFeatures.forEach(f => console.warn(`  - ${f}`));
} else if (!fs.existsSync(serviceAccountPath)) {
  console.warn(`[Firebase] 서비스 계정 키 파일 없음: ${serviceAccountPath}`);
  console.warn('[Firebase] 비활성화 기능:');
  disabledFeatures.forEach(f => console.warn(`  - ${f}`));
} else {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined,
    });
    console.log('[Firebase] Admin SDK 초기화 성공');
  } catch (error) {
    console.error('[Firebase] Admin SDK 초기화 실패:', error.message);
    console.warn('[Firebase] 비활성화 기능:');
    disabledFeatures.forEach(f => console.warn(`  - ${f}`));
  }
}

export const db = admin.apps.length ? admin.firestore() : null;
