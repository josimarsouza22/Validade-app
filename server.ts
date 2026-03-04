import express from "express";
import { createServer as createViteServer } from "vite";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import cors from "cors";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Initialize Database
  const db = await open({
    filename: "./database.sqlite",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT,
      expirationDate TEXT
    )
  `);

  // API Routes
  app.get("/api/products", async (req, res) => {
    try {
      const products = await db.all("SELECT * FROM products");
      res.json(products);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  app.post("/api/products", async (req, res) => {
    const { id, code, name, expirationDate } = req.body;
    try {
      await db.run(
        "INSERT INTO products (id, code, name, expirationDate) VALUES (?, ?, ?, ?)",
        [id, code, name, expirationDate]
      );
      res.status(201).json({ message: "Product created" });
    } catch (error) {
      res.status(500).json({ error: "Failed to create product" });
    }
  });

  app.put("/api/products/:id", async (req, res) => {
    const { id } = req.params;
    const { code, name, expirationDate } = req.body;
    try {
      await db.run(
        "UPDATE products SET code = ?, name = ?, expirationDate = ? WHERE id = ?",
        [code, name, expirationDate, id]
      );
      res.json({ message: "Product updated" });
    } catch (error) {
      res.status(500).json({ error: "Failed to update product" });
    }
  });

  app.delete("/api/products/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await db.run("DELETE FROM products WHERE id = ?", [id]);
      res.json({ message: "Product deleted" });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete product" });
    }
  });

  app.post("/api/products/bulk", async (req, res) => {
    const products = req.body;
    try {
      const stmt = await db.prepare(
        "INSERT OR REPLACE INTO products (id, code, name, expirationDate) VALUES (?, ?, ?, ?)"
      );
      for (const p of products) {
        await stmt.run([p.id, p.code, p.name, p.expirationDate]);
      }
      await stmt.finalize();
      res.json({ message: "Bulk import successful" });
    } catch (error) {
      res.status(500).json({ error: "Failed to bulk import products" });
    }
  });

  app.post("/api/products/bulk-delete", async (req, res) => {
    const { ids } = req.body;
    console.log("Bulk delete request for IDs:", ids);
    
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: "IDs must be an array" });
    }
    
    if (ids.length === 0) {
      return res.json({ message: "No items to delete" });
    }

    try {
      // Delete one by one to guarantee no SQL syntax or binding issues
      for (const id of ids) {
        await db.run("DELETE FROM products WHERE id = ?", [id]);
      }
      console.log(`Successfully deleted ${ids.length} items.`);
      res.json({ message: "Bulk delete successful" });
    } catch (error) {
      console.error("Bulk delete error:", error);
      res.status(500).json({ error: "Failed to bulk delete products" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
