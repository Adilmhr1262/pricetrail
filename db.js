/* PriceTrail db.js — IndexedDB persistence.
   Database: pricetrail, version 1.
   Stores: products (keyPath id), prices (keyPath id, index productId),
   settings (keyPath key). All writes run inside transactions. */

'use strict';

const DB_NAME = 'pricetrail';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('prices')) {
        const prices = db.createObjectStore('prices', { keyPath: 'id' });
        prices.createIndex('productId', 'productId', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is blocked by another tab.'));
  });
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  async getAllProducts() {
    const db = await openDb();
    try {
      const rows = await reqAsPromise(db.transaction('products', 'readonly').objectStore('products').getAll());
      return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    } finally {
      db.close();
    }
  },

  async getProduct(id) {
    const db = await openDb();
    try {
      return await reqAsPromise(db.transaction('products', 'readonly').objectStore('products').get(id));
    } finally {
      db.close();
    }
  },

  async putProduct(product) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const t = db.transaction('products', 'readwrite');
        t.objectStore('products').put(product);
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    } finally {
      db.close();
    }
  },

  async deleteProduct(id) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const t = db.transaction(['products', 'prices'], 'readwrite');
        t.objectStore('products').delete(id);
        const idx = t.objectStore('prices').index('productId');
        const cursorReq = idx.openCursor(IDBKeyRange.only(id));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    } finally {
      db.close();
    }
  },

  async getPricesForProduct(productId) {
    const db = await openDb();
    try {
      const rows = await reqAsPromise(
        db
          .transaction('prices', 'readonly')
          .objectStore('prices')
          .index('productId')
          .getAll(IDBKeyRange.only(productId)),
      );
      return rows;
    } finally {
      db.close();
    }
  },

  async getAllPrices() {
    const db = await openDb();
    try {
      return await reqAsPromise(db.transaction('prices', 'readonly').objectStore('prices').getAll());
    } finally {
      db.close();
    }
  },

  async putPrice(price) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const t = db.transaction('prices', 'readwrite');
        t.objectStore('prices').put(price);
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    } finally {
      db.close();
    }
  },

  async deletePrice(id) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const t = db.transaction('prices', 'readwrite');
        t.objectStore('prices').delete(id);
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    } finally {
      db.close();
    }
  },

  async getSetting(key) {
    const db = await openDb();
    try {
      const row = await reqAsPromise(db.transaction('settings', 'readonly').objectStore('settings').get(key));
      return row ? row.value : undefined;
    } finally {
      db.close();
    }
  },

  async setSetting(key, value) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const t = db.transaction('settings', 'readwrite');
        t.objectStore('settings').put({ key, value });
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    } finally {
      db.close();
    }
  },

  /* Replace the whole dataset in one transaction (used by validated restore).
     All-or-nothing: the transaction only commits when every put succeeds. */
  async replaceAll(products, prices, currency) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const t = db.transaction(['products', 'prices', 'settings'], 'readwrite');
        t.objectStore('products').clear();
        t.objectStore('prices').clear();
        for (const p of products) t.objectStore('products').put(p);
        for (const r of prices) t.objectStore('prices').put(r);
        if (currency) t.objectStore('settings').put({ key: 'currency', value: currency });
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    } finally {
      db.close();
    }
  },

  async clearAll() {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const t = db.transaction(['products', 'prices', 'settings'], 'readwrite');
        t.objectStore('products').clear();
        t.objectStore('prices').clear();
        t.objectStore('settings').clear();
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    } finally {
      db.close();
    }
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DB;
}
