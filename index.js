const express = require("express");
const cors = require("cors");
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion } = require('mongodb');
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;


// Middleware
app.use(express.json());
app.use(cors());

// MongoDB connection



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rukwqku.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    // choose your database
    const db = client.db("VenderSphere_E-Commerce"); //database name

    const usersCollection = db.collection('users');
    const sellersCollection = db.collection("sellers");
    const productsCollection = db.collection("products");
    const categoriesCollection = db.collection("categories");




    // GET: Get user role by email
    app.get('/users/:email/role', async (req, res) => {
      try {
        const email = req.params.email;

        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }

        res.send({ role: user.role || 'seller' });
      } catch (error) {
        console.error('Error getting user role:', error);
        res.status(500).send({ message: 'Failed to get role' });
      }
    });
    // USER REGISTER API

    app.post('/users', async (req, res) => {
      try {
        const { email } = req.body;

        // Check if user already exists
        const userExists = await usersCollection.findOne({ email });
        if (userExists) {
          return res.status(200).json({
            message: 'User already exists',
            inserted: false,
          });
        }

        // Insert new user
        const user = req.body;
        const result = await usersCollection.insertOne(user);

        return res.status(201).json({
          message: 'User created successfully',
          inserted: true,
          result,
        });
      } catch (error) {
        console.error('User insert error:', error);

        // Send only one error response
        if (!res.headersSent) {
          return res.status(500).json({ message: 'Internal Server Error' });
        }
      }
    });

    // ✅ Get user profile by email
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(user);
    });
    // ----------------------
    // SELLER REQUEST API
    // -------------------------

    // Submit seller request
    app.post("/seller-request", async (req, res) => {
      try {
        const { uid } = req.body;

        // Check if seller already applied
        const existing = await sellersCollection.findOne({ uid });

        if (existing) {
          return res.status(400).json({
            message: "You already submitted a seller request.",
          });
        }

        // Insert seller request
        const sellerData = {
          ...req.body,
          status: "pending",
          createdAt: new Date(),
        };

        const result = await sellersCollection.insertOne(sellerData);

        res.status(201).json({
          message: "Seller application submitted successfully!",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Seller request error:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // Get all seller requests (ADMIN)
    // app.get("/seller-request", async (req, res) => {
    //   try {
    //     const requests = await sellersCollection
    //       .find()
    //       .sort({ createdAt: -1 })
    //       .toArray();

    //     res.json(requests);
    //   } catch (error) {
    //     console.error("Fetch seller requests error:", error);
    //     res.status(500).json({ message: "Internal Server Error" });
    //   }
    // });

    // Update seller status (ADMIN approve / reject)
    // app.patch("/seller-request/:id", async (req, res) => {
    //   try {
    //     const { status } = req.body;
    //     const { id } = req.params;

    //     const result = await sellersCollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       { $set: { status: status, updatedAt: new Date() } }
    //     );

    //     res.json({
    //       message: "Seller status updated",
    //       result,
    //     });
    //   } catch (error) {
    //     console.error("Update seller status error:", error);
    //     res.status(500).json({ message: "Internal Server Error" });
    //   }
    // });

    // -----------------
    // add product register api
    //----------------

    app.post("/add-product", async (req, res) => {
      try {
        let product = req.body;

        // Ensure lowercase categories (avoids duplicate categories)
        product.category = product.category.toLowerCase();
        product.subcategory = product.subcategory.toLowerCase();

        // 1️⃣ Insert product into main products collection
        const result = await productsCollection.insertOne(product);
        const insertedId = result.insertedId;

        // Attach the MongoDB _id to product copy
        const productWithId = { ...product, _id: insertedId };

        // 2️⃣ Ensure "products" field exists and is an array
        await categoriesCollection.updateOne(
          {
            category: product.category,
            products: { $exists: true, $not: { $type: "array" } }
          },
          {
            $set: { products: [] }
          }
        );

        // 3️⃣ Add product to categories collection (safe version)
        await categoriesCollection.updateOne(
          { category: product.category },
          {
            $setOnInsert: {
              category: product.category
            },
            $push: {
              products: { $each: [productWithId] }
            }
          },
          { upsert: true }
        );

        res.json({ insertedId });

      } catch (error) {
        console.error("Error adding product:", error);
        res.status(500).json({ message: "Failed to add product" });
      }
    });


    // -------------------------
    // show product categories
    // --------------------
    app.get("/products", async (req, res) => {
      const category = req.query.category; // e.g., /products?category=Electronics
      const query = category ? { category } : {};
      const products = await productsCollection.find(query).toArray();
      res.send(products);
    });

    // ----------------------
    // GET all categories
    // ------------------
    app.get("/categories", async (req, res) => {
      try {
        const categories = await categoriesCollection.find().toArray();
        res.json(categories);
      } catch (error) {
        console.error("Error fetching categories:", error);
        res.status(500).json({ message: "Failed to load categories" });
      }
    });


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);







// Test route
app.get("/", (req, res) => {
  res.send("venderSphere Backend server is running!");
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ venderSphere Server is running on port ${PORT}`);
});
