import fs from 'fs';
import path from 'path';
import { getEnv } from '../config/env.js';

function replacer(key, value) {
  if (typeof value === 'bigint') {
    return { __type: 'BigInt', value: value.toString() };
  }
  return value;
}

function reviver(key, value) {
  if (value && typeof value === 'object' && value.__type === 'BigInt') {
    return BigInt(value.value);
  }
  return value;
}

export class JsonDb {
  constructor(dataDir = getEnv().dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.positionsFile = path.join(this.dataDir, 'positions.json');
    this.transactionsFile = path.join(this.dataDir, 'transactions.json');
    this.poolsCacheFile = path.join(this.dataDir, 'pools_cache.json');
    this.init();
  }

  init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.positionsFile)) {
      fs.writeFileSync(this.positionsFile, JSON.stringify([], null, 2), 'utf8');
    }
    if (!fs.existsSync(this.transactionsFile)) {
      fs.writeFileSync(this.transactionsFile, JSON.stringify([], null, 2), 'utf8');
    }
    if (!fs.existsSync(this.poolsCacheFile)) {
      fs.writeFileSync(this.poolsCacheFile, JSON.stringify({}, null, 2), 'utf8');
    }
  }

  _readJson(filePath, defaultValue) {
    try {
      if (!fs.existsSync(filePath)) return defaultValue;
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content, reviver);
    } catch (error) {
      console.error(`Error reading JSON file ${filePath}:`, error.message);
      return defaultValue;
    }
  }

  _writeJson(filePath, data) {
    try {
      const content = JSON.stringify(data, replacer, 2);
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (error) {
      console.error(`Error writing JSON file ${filePath}:`, error.message);
    }
  }

  // --- POSITIONS ---
  getPositions() {
    return this._readJson(this.positionsFile, []);
  }

  getPositionByTokenId(tokenId) {
    const positions = this.getPositions();
    return positions.find(p => p.tokenId.toString() === tokenId.toString()) || null;
  }

  savePosition(positionData) {
    const positions = this.getPositions();
    const index = positions.findIndex(p => p.tokenId.toString() === positionData.tokenId.toString());
    const record = {
      ...positionData,
      updatedAt: new Date().toISOString(),
    };
    if (index >= 0) {
      positions[index] = record;
    } else {
      record.createdAt = new Date().toISOString();
      positions.push(record);
    }
    this._writeJson(this.positionsFile, positions);
    return record;
  }

  updatePosition(tokenId, updates) {
    const positions = this.getPositions();
    const index = positions.findIndex(p => p.tokenId.toString() === tokenId.toString());
    if (index < 0) return null;
    positions[index] = {
      ...positions[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this._writeJson(this.positionsFile, positions);
    return positions[index];
  }

  // --- TRANSACTIONS ---
  getTransactions() {
    return this._readJson(this.transactionsFile, []);
  }

  saveTransaction(txRecord) {
    const transactions = this.getTransactions();
    const record = {
      ...txRecord,
      timestamp: new Date().toISOString(),
    };
    transactions.unshift(record);
    this._writeJson(this.transactionsFile, transactions);
    return record;
  }

  // --- POOLS CACHE ---
  getPoolsCache() {
    return this._readJson(this.poolsCacheFile, {});
  }

  getPoolFromCache(poolKey) {
    const cache = this.getPoolsCache();
    return cache[poolKey.toLowerCase()] || null;
  }

  savePoolToCache(poolKey, poolData) {
    const cache = this.getPoolsCache();
    cache[poolKey.toLowerCase()] = {
      ...poolData,
      cachedAt: new Date().toISOString(),
    };
    this._writeJson(this.poolsCacheFile, cache);
  }
}

export const db = new JsonDb();
