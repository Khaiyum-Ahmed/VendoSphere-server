const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});




const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rukwqku.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("VenderSphere_E-Commerce");

    const usersCollection = db.collection("users");
    const sellersCollection = db.collection("sellers");
    const productsCollection = db.collection("products");
    const categoriesCollection = db.collection("categories");
    const reviewsCollection = db.collection("reviews");
    const testimonialsCollection = db.collection("testimonials");
    const newsletterCollection = db.collection("newsletter");
    const cartsCollection = db.collection("carts");



    /* ================= USERS ================= */

    app.post("/users", async (req, res) => {
      const { email } = req.body;
      const exists = await usersCollection.findOne({ email });
      if (exists) return res.send({ inserted: false });
      const result = await usersCollection.insertOne(req.body);
      res.send({ inserted: true, result });
    });

    app.get("/users/:email", async (req, res) => {
      const user = await usersCollection.findOne({ email: req.params.email });
      res.send(user);
    });

    app.get("/users/:email/role", async (req, res) => {
      const user = await usersCollection.findOne({ email: req.params.email });
      res.send({ role: user?.role || "customer" });
    });

    /* ================= SELLER ================= */

    app.post("/seller-request", async (req, res) => {
      const exists = await sellersCollection.findOne({ uid: req.body.uid });
      if (exists) return res.status(400).send({ message: "Already applied" });

      const result = await sellersCollection.insertOne({
        ...req.body,
        status: "pending",
        createdAt: new Date(),
      });

      res.send(result);
    });

    // GET /sellers/top
    app.get("/sellers/top", async (req, res) => {
      try {
        const sellers = await sellersCollection
          .find()
          .sort({ rating: -1 }) // top-rated sellers
          .limit(8)
          .toArray();

        // Include product count for each seller
        const sellersWithCount = await Promise.all(
          sellers.map(async (seller) => {
            const count = await productsCollection.countDocuments({ sellerEmail: seller.email });
            return { ...seller, productCount: count };
          })
        );

        res.json(sellersWithCount);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch top sellers" });
      }
    });

    // GET seller products with pagination
    app.get("/seller/products", async (req, res) => {
      const email = req.query.email;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      if (!email) {
        return res.status(400).send({ message: "Seller email required" });
      }

      const query = { sellerEmail: email };

      const total = await productsCollection.countDocuments(query);
      const products = await productsCollection
        .find(query)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .toArray();

      res.send({
        products,
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      });
    });


    // DELETE product
    app.delete("/products/:id", async (req, res) => {
      const id = req.params.id;
      await productsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ success: true });
    });

    // TOGGLE status
    app.patch("/products/status/:id", async (req, res) => {
      const { status } = req.body;
      await productsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status } }
      );
      res.send({ success: true });
    });



    /* ================= ADD PRODUCT ================= */

    app.post("/add-product", async (req, res) => {
      let product = req.body;

      product.category = product.category.toLowerCase();
      product.createdAt = new Date();
      product.rating = 0;
      product.reviewCount = 0;

      const result = await productsCollection.insertOne(product);

      await categoriesCollection.updateOne(
        { category: product.category },
        {
          $setOnInsert: { category: product.category },
          $push: { products: { ...product, _id: result.insertedId } },
        },
        { upsert: true }
      );

      res.send({ insertedId: result.insertedId });
    });

    /* ================= PRODUCTS ================= */

    // ----------------------
    // GET /products (FILTER + SORT + PAGINATION)
    // ----------------------
    app.get("/products", async (req, res) => {
      try {
        const {
          category,
          search,
          price_min,
          price_max,
          rating_gte,
          seller,
          sort,
          flash,
          page = 1,
          limit = 12,
        } = req.query;

        const query = {};

        // Category
        if (category) {
          query.category = category.toLowerCase();
        }

        // Search
        if (search) {
          query.$or = [
            { productName: { $regex: search, $options: "i" } },
            { brand: { $regex: search, $options: "i" } },
          ];
        }

        // Price range
        if (price_min || price_max) {
          query.price = {};
          if (price_min) query.price.$gte = Number(price_min);
          if (price_max) query.price.$lte = Number(price_max);
        }

        // Rating
        if (rating_gte) {
          query.rating = { $gte: Number(rating_gte) };
        }

        // Flash sale
        if (flash === "true") {
          query.discount = { $gt: 0 };
        }

        // Seller
        if (seller) {
          query.sellerId = seller;
        }

        // Sorting
        let sortQuery = {};
        switch (sort) {
          case "price_asc":
            sortQuery.price = 1;
            break;
          case "price_desc":
            sortQuery.price = -1;
            break;
          case "rating_desc":
            sortQuery.rating = -1;
            break;
          case "newest":
            sortQuery.createdAt = -1;
            break;
          case "sold_desc":
            sortQuery.sold = -1;
            break;
          default:
            sortQuery.createdAt = -1;
        }

        const skip = (Number(page) - 1) * Number(limit);

        const products = await productsCollection
          .find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(Number(limit))
          .toArray();

        const total = await productsCollection.countDocuments(query);

        res.json({
          products,
          total,
          page: Number(page),
          totalPages: Math.ceil(total / limit),
        });
      } catch (error) {
        console.error("Shop products error:", error);
        res.status(500).json({ message: "Failed to load products" });
      }
    });


    // app.get("/products", async (req, res) => {
    //   const category = req.query.category;
    //   const query = category ? { category } : {};
    //   const products = await productsCollection.find(query).toArray();
    //   res.send(products);
    // });

    app.get("/products/featured", async (req, res) => {
      const products = await productsCollection
        .find()
        .sort({ rating: -1, createdAt: -1 })
        .limit(12)
        .toArray();

      res.send(products);
    });

    // Edit Product by id

    app.get("/product/:id", async (req, res) => {
      try {
        const product = await productsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });

        res.send(product);
      } catch (error) {
        console.error("Get Product Error:", error);
        res.status(500).send({ message: "Failed to fetch product" });
      }
    });

    app.patch("/products/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updatedData = req.body;

        // Prevent ID overwrite
        delete updatedData._id;

        const result = await productsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );

        if (result.modifiedCount === 0) {
          return res
            .status(400)
            .send({ message: "No changes detected" });
        }

        res.send({ success: true });
      } catch (error) {
        console.error("Update Product Error:", error);
        res.status(500).send({ message: "Product update failed" });
      }
    });


    // --------------------
    // GET /products/flash-sale
    // -------------------

    app.get("/products/flash-sale", async (req, res) => {
      try {
        // Fetch products that have a discount or flashSale flag
        const products = await productsCollection
          .find({ discount: { $exists: true, $gt: 0 } })
          .sort({ createdAt: -1 }) // newest first
          .limit(12) // max 12 for carousel
          .toArray();

        res.json(products);
      } catch (error) {
        console.error("Error fetching flash sale products:", error);
        res.status(500).json({ message: "Failed to load flash sale products" });
      }
    });


    /* ================= CATEGORIES ================= */

    app.get("/categories", async (req, res) => {
      const categories = await categoriesCollection.find().toArray();
      res.send(categories);
    });

    /* ================= REVIEWS ================= */

    app.get("/product/:id/reviews", async (req, res) => {
      const reviews = await reviewsCollection
        .find({ productId: req.params.id })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(reviews);
    });

    app.post("/product/:id/review", async (req, res) => {
      const { userEmail, userName, rating, comment } = req.body;
      const productId = req.params.id;

      const exists = await reviewsCollection.findOne({
        productId,
        userEmail,
      });

      if (exists) {
        return res.status(400).send({ message: "Already reviewed" });
      }

      await reviewsCollection.insertOne({
        productId,
        userEmail,
        userName,
        rating: Number(rating),
        comment,
        createdAt: new Date(),
      });

      const reviews = await reviewsCollection
        .find({ productId })
        .toArray();

      const avg =
        reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

      await productsCollection.updateOne(
        { _id: new ObjectId(productId) },
        {
          $set: {
            rating: Number(avg.toFixed(1)),
            reviewCount: reviews.length,
          },
        }
      );

      res.send({ success: true });
    });


    /* ================= testimonials ================= */


    // ----------------------
    // GET all testimonials
    // ----------------------
    app.get("/testimonials", async (req, res) => {
      try {


        const testimonials = await testimonialsCollection.find().toArray();
        res.json(testimonials);
      } catch (error) {
        console.error("Error fetching testimonials:", error);
        res.status(500).json({ message: "Failed to fetch testimonials" });
      }
    });


    // ----------------------
    // newsletter
    // ----------------------

    app.post("/newsletter", async (req, res) => {
      try {
        const { email } = req.body;

        // Basic validation
        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        // Check duplicate
        const exists = await newsletterCollection.findOne({ email });
        if (exists) {
          return res.status(409).json({ message: "Email already exists" });
        }

        // Save to DB
        await newsletterCollection.insertOne({
          email,
          subscribedAt: new Date(),
        });

        // Send confirmation email
        await transporter.sendMail({
          from: `"VenderSphere" <${process.env.MAIL_USER}>`,
          to: email,
          subject: "🎉 Subscription Confirmed!",
          html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6">
          <h2>Welcome to VenderSphere 🎉</h2>
          <p>Thanks for subscribing to our newsletter.</p>
          <p>You’ll receive:</p>
          <ul>
            <li>🔥 Flash Sale Alerts</li>
            <li>🛍️ New Product Updates</li>
            <li>🎁 Exclusive Offers</li>
          </ul>
          <p>Stay with us!</p>
          <strong>— VenderSphere Team</strong>
        </div>
      `,
        });

        res.json({ success: true });
      } catch (error) {
        console.error("Newsletter Error:", error);
        res.status(500).json({ message: "Subscription failed" });
      }
    });


    /* ================= Cart PRODUCTS ================= */


    app.get("/cart/:email", async (req, res) => {
      const email = req.params.email;

      const cart = await cartsCollection.findOne({ userEmail: email });

      res.send(cart || { userEmail: email, items: [] });
    });


    app.post("/cart", async (req, res) => {
      const { userEmail, product } = req.body;

      const filter = { userEmail };
      const cart = await cartsCollection.findOne(filter);

      if (!cart) {
        // create new cart
        await cartsCollection.insertOne({
          userEmail,
          items: [
            {
              productId: new ObjectId(product._id),
              name: product.name,
              price: product.price,
              image: product.images,
              quantity: 1,
            },
          ],
          updatedAt: new Date(),
        });

        return res.send({ success: true, message: "Cart created" });
      }

      const exists = cart.items.find(
        (item) => item.productId.toString() === product._id
      );

      if (exists) {
        await cartsCollection.updateOne(
          { userEmail, "items.productId": new ObjectId(product._id) },
          {
            $inc: { "items.$.quantity": 1 },
            $set: { updatedAt: new Date() },
          }
        );
      } else {
        await cartsCollection.updateOne(
          { userEmail },
          {
            $push: {
              items: {
                productId: new ObjectId(product._id),
                name: product.name,
                price: product.price,
                image: product.images,
                quantity: 1,
              },
            },
            $set: { updatedAt: new Date() },
          }
        );
      }

      res.send({ success: true });
    });


    // update quantity

    app.patch("/cart/quantity", async (req, res) => {
      const { userEmail, productId, quantity } = req.body;

      if (quantity < 1) {
        return res.status(400).send({ message: "Quantity must be at least 1" });
      }

      await cartsCollection.updateOne(
        { userEmail, "items.productId": new ObjectId(productId) },
        {
          $set: {
            "items.$.quantity": quantity,
            updatedAt: new Date(),
          },
        }
      );

      res.send({ success: true });
    });


    // remove cart 
    app.delete("/cart/item", async (req, res) => {
      const { userEmail, productId } = req.body;

      await cartsCollection.updateOne(
        { userEmail },
        {
          $pull: { items: { productId: new ObjectId(productId) } },
          $set: { updatedAt: new Date() },
        }
      );

      res.send({ success: true });
    });

    // clear cart 
    app.delete("/cart/:email", async (req, res) => {
      await cartsCollection.deleteOne({ userEmail: req.params.email });
      res.send({ success: true });
    });




    /* ================= RELATED PRODUCTS ================= */

    app.get("/products/related/:id", async (req, res) => {
      const product = await productsCollection.findOne({
        _id: new ObjectId(req.params.id),
      });

      if (!product) return res.send([]);

      const related = await productsCollection
        .find({
          category: product.category,
          _id: { $ne: product._id },
        })
        .limit(8)
        .toArray();

      res.send(related);
    });

    console.log("✅ MongoDB connected");
  } finally {
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("✅ VenderSphere Backend Running");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
