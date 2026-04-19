import { createCipheriv, createDecipheriv, createHash } from 'crypto';

const algorithm = 'aes-256-cbc';
const defaultSecret = 'openwork-chat-wechat-publish-secret';
const defaultIv = 'openwork-chat-weiv';

function buildKey() {
  return createHash('sha256')
    .update(process.env.PUBLISH_ACCOUNT_CIPHER_KEY || defaultSecret)
    .digest();
}

function buildIv() {
  return Buffer.from((process.env.PUBLISH_ACCOUNT_CIPHER_IV || defaultIv).padEnd(16, '0')).subarray(
    0,
    16,
  );
}

export function encryptPublishSecret(value: string) {
  const cipher = createCipheriv(algorithm, buildKey(), buildIv());
  let encrypted = cipher.update(value || '', 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

export function decryptPublishSecret(value: string) {
  const decipher = createDecipheriv(algorithm, buildKey(), buildIv());
  let decrypted = decipher.update(value || '', 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
