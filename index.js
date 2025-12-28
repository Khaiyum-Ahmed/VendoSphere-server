const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

const safeObjectId = (id) => {
  if (!id) return null;
  if (!ObjectId.isValid(id)) return null;
  return new ObjectId(id);
};

dotenv.config();

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY)

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


const serviceAccount = require("./firebase-admin-key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});






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
    const ordersCollection = db.collection("orders");
    const payoutsCollection = db.collection("payouts");
    const wishlistCollection = db.collection("wishlists");
    const paymentsCollection = db.collection("payments");




    // custom middlewares

    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: 'UnAuthorized access' })
      }
      const token = authHeader.split(' ')[1];
      if (!token) {
        return res.status(401).send({ message: 'UnAuthorized access' })
      }
      // verify the token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      }
      catch (error) {
        return res.status(403).send({ message: 'Forbidden access' })
      }

      console.log('header in middleware', authHeader)

    }




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

    app.patch("/users/profile", verifyFBToken, async (req, res) => {
      try {
        const { email, name, phone, image } = req.body;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const result = await usersCollection.updateOne(
          { email },
          {
            $set: {
              name,
              phone,
              image,
              updatedAt: new Date(),
            },
          }
        );

        res.send({ success: true, result });
      } catch (error) {
        console.error("Profile update error:", error);
        res.status(500).send({ message: "Profile update failed" });
      }
    });

    /* ================= Customer ================= */

    app.get("/customer/profile", verifyFBToken, async (req, res) => {
      try {
        const { email } = req.query;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const user = await usersCollection.findOne(
          { email },
          { projection: { password: 0 } } // safety
        );

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error("Customer profile fetch error:", error);
        res.status(500).send({ message: "Failed to load profile" });
      }
    });

    app.patch("/customer/profile", async (req, res) => {
      try {
        const { email, name, phone, address } = req.body;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const updateData = {
          name,
          phone,
          address,
          updatedAt: new Date(),
        };

        const result = await usersCollection.updateOne(
          { email },
          { $set: updateData }
        );

        if (result.modifiedCount === 0) {
          return res.send({ success: false, message: "No changes detected" });
        }

        res.send({ success: true });
      } catch (error) {
        console.error("Customer profile update error:", error);
        res.status(500).send({ message: "Profile update failed" });
      }
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



    app.get("/seller/dashboard-overview", async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).send({ message: "Seller email required" });
      }

      // total products
      const totalProducts = await productsCollection.countDocuments({
        sellerEmail: email,
      });

      // active orders
      const activeOrders = await ordersCollection.countDocuments({
        sellerEmail: email,
        status: { $in: ["Pending", "Processing"] },
      });

      // recent orders
      const recentOrders = await ordersCollection
        .find({ sellerEmail: email })
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      // revenue calculations
      const completedOrders = await ordersCollection
        .find({ sellerEmail: email, status: "Delivered" })
        .toArray();

      const totalRevenue = completedOrders.reduce(
        (sum, order) => sum + order.totalAmount,
        0
      );

      const pendingEarnings = completedOrders
        .filter((o) => !o.payoutRequested)
        .reduce((sum, o) => sum + o.totalAmount, 0);

      res.send({
        totalProducts,
        activeOrders,
        pendingEarnings: pendingEarnings.toFixed(2),
        totalRevenue: totalRevenue.toFixed(2),
        recentOrders,
      });
    });



    app.get("/customer-stats", async (req, res) => {
      const { email } = req.query;

      const orders = await ordersCollection.find({ userEmail: email }).toArray();
      const wishlist = await wishlistCollection.findOne({ userEmail: email });

      const totalSpent = orders.reduce((sum, o) => sum + o.total, 0);

      const statusCount = {
        pendingOrders: orders.filter(o => o.status === "pending").length,
        shippedOrders: orders.filter(o => o.status === "shipped").length,
        deliveredOrders: orders.filter(o => o.status === "delivered").length,
        cancelledOrders: orders.filter(o => o.status === "cancelled").length,
      };

      res.send({
        totalOrders: orders.length,
        totalSpent,
        wishlistCount: wishlist?.items?.length || 0,
        ...statusCount,
        notifications: [
          statusCount.pendingOrders > 0 && "You have pending orders",
          statusCount.shippedOrders > 0 && "Some orders are on the way",
        ].filter(Boolean),
      });
    });

    app.get("/recent-orders", async (req, res) => {
      const { email } = req.query;

      const orders = await ordersCollection
        .find({ userEmail: email })
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      res.send(orders);
    });




    /* ================= SELLER STORE PAGE ================= */

    app.get("/stores/:sellerId", async (req, res) => {
      try {

        const { sellerId } = req.params;

        const sellerObjectId = safeObjectId(sellerId);
        if (!sellerObjectId) {
          return res.status(400).send({ message: "Invalid seller ID" });
        }

        const seller = await sellersCollection.findOne({
          _id: sellerObjectId,
        });

        if (!seller) {
          return res.status(404).send({ message: "Seller not found" });
        }

        // Fetch seller products
        const products = await productsCollection
          .find({ sellerId, status: "active" })
          .toArray();

        // Fetch completed orders for total sales
        const completedOrders = await ordersCollection
          .find({ sellerId, status: "completed" })
          .toArray();

        const totalSales = completedOrders.reduce((sum, o) => sum + o.totalAmount, 0);

        // Fetch reviews
        const reviews = await reviewsCollection
          .find({ sellerId })
          .toArray();

        const rating =
          reviews.length > 0
            ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
            : 0;

        res.send({
          store: {
            storeName: seller.storeName,
            description: seller.storeDescription,
            avatar: seller.avatar,
            banner: seller.banner,
            location: seller.location,
            website: seller.website || null
          },
          stats: {
            totalProducts: products.length,
            totalSales,
            rating,
            totalReviews: reviews.length,
            followersCount: seller.followers?.length || 0
          },
          products,
          reviews
        });
      } catch (error) {
        console.error("Seller store page error:", error);
        res.status(500).send({ message: "Failed to fetch seller store page" });
      }
    });



    /* ================= SELLER Sales Report ================= */


    app.get("/seller/sales-report", async (req, res) => {
      try {
        const sellerEmail = req.query.email;
        if (!sellerEmail) return res.status(400).json({ message: "Seller email required" });

        // Get all orders for this seller
        const orders = await ordersCollection
          .find({ "products.sellerEmail": sellerEmail })
          .toArray();

        // Revenue by month (last 12 months)
        const revenueByMonth = {};
        const now = new Date();
        for (let i = 0; i < 12; i++) {
          const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = month.toLocaleString("default", { month: "short", year: "numeric" });
          revenueByMonth[key] = 0;
        }

        orders.forEach(order => {
          order.products.forEach(p => {
            if (p.sellerEmail === sellerEmail) {
              const orderDate = new Date(order.createdAt);
              const key = orderDate.toLocaleString("default", { month: "short", year: "numeric" });
              if (revenueByMonth[key] !== undefined) {
                revenueByMonth[key] += p.price * p.quantity;
              }
            }
          });
        });

        // Orders by status
        const ordersByStatus = orders.reduce((acc, order) => {
          acc[order.status] = (acc[order.status] || 0) + 1;
          return acc;
        }, {});

        res.json({
          revenueByMonth,
          ordersByStatus,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch sales report" });
      }
    });


    /* ================= SELLER Earnings ================= */


    app.get("/seller/earnings", async (req, res) => {
      try {
        const { email } = req.query;

        if (!email) {
          return res.status(400).send({ message: "Seller email required" });
        }

        /* ================= TOTAL REVENUE ================= */
        const deliveredOrders = await ordersCollection.find({
          sellerEmail: email,
          status: "delivered",
        }).toArray();

        const totalRevenue = deliveredOrders.reduce(
          (sum, order) => sum + order.totalAmount,
          0
        );

        /* ================= PAYOUTS ================= */
        const payouts = await payoutsCollection
          .find({ sellerEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        const paidOut = payouts
          .filter(p => p.status === "paid")
          .reduce((sum, p) => sum + p.amount, 0);

        const pendingPayouts = payouts
          .filter(p => p.status === "pending" || p.status === "approved")
          .reduce((sum, p) => sum + p.amount, 0);

        /* ================= BALANCE ================= */
        const balance = totalRevenue - paidOut - pendingPayouts;

        res.send({
          totalRevenue,
          paidOut,
          pendingPayouts,
          balance,
          payouts,
        });

      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch earnings" });
      }
    });

    // seller Payouts


    app.post("/seller/payouts", async (req, res) => {
      try {
        const { sellerEmail, amount, method } = req.body;

        if (!sellerEmail || !amount || !method) {
          return res.status(400).send({ message: "Missing fields" });
        }

        if (amount < 50) {
          return res.status(400).send({ message: "Minimum payout is $50" });
        }

        /* ================= CALCULATE BALANCE AGAIN ================= */
        const deliveredOrders = await ordersCollection.find({
          sellerEmail,
          status: "delivered",
        }).toArray();

        const totalRevenue = deliveredOrders.reduce(
          (sum, o) => sum + o.totalAmount,
          0
        );

        const payouts = await payoutsCollection.find({ sellerEmail }).toArray();

        const paidOut = payouts
          .filter(p => p.status === "paid")
          .reduce((s, p) => s + p.amount, 0);

        const pending = payouts
          .filter(p => p.status === "pending" || p.status === "approved")
          .reduce((s, p) => s + p.amount, 0);

        const balance = totalRevenue - paidOut - pending;

        if (amount > balance) {
          return res.status(400).send({ message: "Insufficient balance" });
        }

        /* ================= CREATE PAYOUT ================= */
        const payout = {
          sellerEmail,
          amount,
          method,
          status: "pending",
          adminNote: "",
          createdAt: new Date(),
          processedAt: null,
        };

        const result = await payoutsCollection.insertOne(payout);

        res.send(result);

      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Payout request failed" });
      }
    });

    app.patch("/payouts/:id", async (req, res) => {
      try {
        const { status, adminNote } = req.body;

        if (!["approved", "rejected", "paid"].includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const update = {
          status,
          adminNote: adminNote || "",
        };

        if (status === "paid") {
          update.processedAt = new Date();
        }

        const result = await payoutsCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: update }
        );

        res.send(result);

      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to update payout" });
      }
    });


    app.get("/seller/payouts", async (req, res) => {
      const { email } = req.query;

      const payouts = await payoutsCollection
        .find({ sellerEmail: email })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(payouts);
    });


    /* ================== SELLER PROFILE ================== */

    // GET seller profile
    app.get("/seller/profile", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ message: "Email is required" });

        const seller = await sellersCollection.findOne({ email });
        if (!seller) return res.status(404).json({ message: "Seller not found" });

        res.json(seller);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch profile" });
      }
    });

    // UPDATE seller profile
    app.put("/seller/profile", async (req, res) => {
      try {
        const { email, storeName, description, avatar, banner, phone, socialLinks, password } = req.body;
        if (!email) return res.status(400).json({ message: "Email is required" });

        const updateFields = { storeName, description, avatar, banner, phone, socialLinks };

        if (password) {
          // Hash the password before saving
          const bcrypt = require("bcryptjs");
          const hashedPassword = await bcrypt.hash(password, 10);
          updateFields.password = hashedPassword;
        }

        const result = await sellersCollection.updateOne(
          { email },
          { $set: updateFields }
        );

        res.json({ success: true, result });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to update profile" });
      }
    });




    /* ================= SELLER ORDERS ================= */


    app.post("/orders", async (req, res) => {
      const order = {
        ...req.body,
        status: "pending",
        createdAt: new Date(),
      };

      const result = await ordersCollection.insertOne(order);
      res.send(result);
    });


    app.get("/seller/orders", async (req, res) => {
      const { email, status } = req.query;

      const query = { sellerEmail: email };

      if (status) {
        query.status = status;
      }

      const orders = await ordersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      res.send(orders);
    });


    app.patch("/orders/:id", async (req, res) => {
      const { status } = req.body;

      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status } }
      );

      res.send(result);
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

    /* ================= WishList PRODUCTS ================= */


    // ADD TO WISHLIST
    app.post("/wishlist", async (req, res) => {
      try {
        const { userEmail, productId } = req.body;

        if (!userEmail || !productId) {
          return res.status(400).send({ message: "Missing data" });
        }
        if (!ObjectId.isValid(productId)) {
          return res.status(400).send({ message: "Invalid product ID" });
        }


        const exists = await wishlistCollection.findOne({
          userEmail,
          productId: new ObjectId(productId)
        });

        if (exists) {
          return res.status(409).send({ message: "Already in wishlist" });
        }

        await wishlistCollection.insertOne({
          userEmail,
          productId: new ObjectId(productId),
          createdAt: new Date(),
        });

        res.send({ success: true });
      } catch (error) {
        console.error("Wishlist add error:", error);
        res.status(500).send({ message: "Failed to add wishlist" });
      }
    });

    // GET USER WISHLIST /:email
    app.get("/wishlist", async (req, res) => {
      // const email = req.params.email;
      const { email } = req.query;

      const wishlist = await wishlistCollection
        .aggregate([
          { $match: { userEmail: email } },
          {
            $lookup: {
              from: "products",
              localField: "productId",
              foreignField: "_id",
              as: "product",
            },
          },
          { $unwind: "$product" },
        ])
        .toArray();

      res.send(wishlist);
    });

    // REMOVE FROM WISHLIST
    app.delete("/wishlist", async (req, res) => {
      const { userEmail, productId } = req.body;

      const pid = safeObjectId(productId);
      if (!pid) {
        return res.status(400).send({ message: "Invalid Product ID" });
      }
      await wishlistCollection.deleteOne({
        userEmail,
        productId: pid,
      });

      res.send({ success: true });
    });


    /* ================= ORDERS PRODUCTS ================= */


    app.get("/orders", async (req, res) => {
      const { email, status, search, sort } = req.query;

      const query = { userEmail: email };

      if (status) query.status = status;

      if (search) {
        const oid = safeObjectId(search);
        if (!oid) {
          return res.status(400).send({ message: "Invalid order ID" });
        }
        query._id = oid;
      }

      let cursor = ordersCollection.find(query);

      if (sort === "oldest") {
        cursor = cursor.sort({ createdAt: 1 });
      } else {
        cursor = cursor.sort({ createdAt: -1 });
      }

      const orders = await cursor.toArray();
      res.send(orders);
    });


    // GET /orders/:id
    app.get("/orders/:id", async (req, res) => {
      const orderId = safeObjectId(req.params.id);
      if (!orderId) {
        return res.status(400).send({ message: "Invalid order ID" });
      }

      const order = await ordersCollection.findOne({ _id: orderId });

      res.send(order);
    });

    app.patch("/orders/:id/cancel", async (req, res) => {
      const order = await ordersCollection.findOne({
        _id: new ObjectId(req.params.id),
      });

      if (order.status !== "Pending") {
        return res.status(400).send({ message: "Order cannot be cancelled" });
      }

      const created = new Date(order.createdAt);
      const now = new Date();
      const diffMinutes = (now - created) / (1000 * 60);

      if (diffMinutes > 60) {
        return res.status(403).send({ message: "Cancellation window expired" });
      }

      await ordersCollection.updateOne(
        { _id: order._id },
        { $set: { status: "Cancelled" } }
      );

      res.send({ success: true });
    });



    /* ================= REORDER ================= */

    app.post("/orders/:id/reorder", async (req, res) => {
      try {
        const orderId = req.params.id;

        const oid = safeObjectId(orderId);
        if (!oid) {
          return res.status(400).send({ message: "Invalid order ID" });
        }

        const order = await ordersCollection.findOne({ _id: oid });

        if (!order) {
          return res.status(404).send({ message: "Order not found" });
        }

        const { userEmail, products } = order;

        const cart = await cartsCollection.findOne({ userEmail });

        if (!cart) {
          // create cart from order
          await cartsCollection.insertOne({
            userEmail,
            items: products.map(p => ({
              productId: new ObjectId(p.productId),
              name: p.name,
              price: p.price,
              image: p.image,
              quantity: p.quantity,
            })),
            updatedAt: new Date(),
          });

          return res.send({ success: true });
        }

        // merge items
        for (const item of products) {
          const exists = cart.items.find(
            i => i.productId.toString() === item.productId.toString()
          );

          if (exists) {
            await cartsCollection.updateOne(
              {
                userEmail,
                "items.productId": new ObjectId(item.productId),
              },
              { $inc: { "items.$.quantity": item.quantity } }
            );
          } else {
            await cartsCollection.updateOne(
              { userEmail },
              {
                $push: {
                  items: {
                    productId: new ObjectId(item.productId),
                    name: item.name,
                    price: item.price,
                    image: item.image,
                    quantity: item.quantity,
                  },
                },
              }
            );
          }
        }

        await cartsCollection.updateOne(
          { userEmail },
          { $set: { updatedAt: new Date() } }
        );

        res.send({ success: true });
      } catch (error) {
        console.error("Reorder error:", error);
        res.status(500).send({ message: "Reorder failed" });
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
      const pid = safeObjectId(productId || product?._id);
      if (!pid) {
        return res.status(400).send({ message: "Invalid product ID" });
      }

      if (exists) {
        await cartsCollection.updateOne(
          { userEmail, "items.productId": new ObjectId(pid) },
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
                productId: new ObjectId(pid),
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
      const pid = safeObjectId(productId || product?._id);
      if (!pid) {
        return res.status(400).send({ message: "Invalid product ID" });
      }

      await cartsCollection.updateOne(
        { userEmail, "items.productId": new ObjectId(pid) },
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
      const pid = safeObjectId(productId || product?._id);
      if (!pid) {
        return res.status(400).send({ message: "Invalid product ID" });
      }
      await cartsCollection.updateOne(
        { userEmail },
        {
          $pull: { items: { productId: new ObjectId(pid) } },
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


    // ================= ADMIN DASHBOARD =================


    app.get("/admin/overview", async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalSellers = await sellersCollection.countDocuments();
        const pendingSellers = await sellersCollection.countDocuments({
          status: "pending",
        });

        const totalProducts = await productsCollection.countDocuments();
        const totalOrders = await ordersCollection.countDocuments();

        const pendingWithdraws = await payoutsCollection.countDocuments({
          status: "pending",
        });

        res.send({
          totalUsers,
          totalSellers,
          pendingSellers,
          totalProducts,
          totalOrders,
          pendingWithdraws,
        });
      } catch (error) {
        console.error("Admin overview error:", error);
        res.status(500).send({ message: "Failed to load admin overview" });
      }
    });


    // ================= ADMIN - MANAGE USERS =================

    app.get("/admin/users", async (req, res) => {
      try {
        const users = await usersCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();

        res.send(users);
      } catch (error) {
        console.error("Fetch users error:", error);
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });


    // EDIT USER (name, phone)
    app.patch("/admin/users/:id", async (req, res) => {
      try {
        const { name, phone } = req.body;

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          {
            $set: {
              name,
              phone,
            },
          }
        );

        res.send({ success: true, result });
      } catch (error) {
        console.error("Edit user error:", error);
        res.status(500).send({ message: "Failed to update user" });
      }
    });


    // SUSPEND / ACTIVATE USER
    app.patch("/admin/users/:id/status", async (req, res) => {
      try {
        const { status } = req.body;

        if (!["active", "suspended"].includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { status } }
        );

        res.send({ success: true, result });
      } catch (error) {
        console.error("Update status error:", error);
        res.status(500).send({ message: "Failed to update status" });
      }
    });


    app.delete("/admin/users/:id", async (req, res) => {
      try {
        await usersCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });

        res.send({ success: true });
      } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).send({ message: "Failed to delete user" });
      }
    });



    // ================= ADMIN - MANAGE SELLERS =================

    app.get("/admin/sellers", async (req, res) => {
      try {
        const sellers = await sellersCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();

        // add rating dynamically
        const sellersWithRating = await Promise.all(
          sellers.map(async (seller) => {
            const reviews = await reviewsCollection
              .find({ sellerId: seller._id.toString() })
              .toArray();

            const rating =
              reviews.length > 0
                ? (
                  reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
                ).toFixed(1)
                : 0;

            return { ...seller, rating };
          })
        );

        res.send(sellersWithRating);
      } catch (error) {
        console.error("Fetch sellers error:", error);
        res.status(500).send({ message: "Failed to fetch sellers" });
      }
    });

    // seller Approve/reject 

    app.patch("/admin/sellers/status/:id", async (req, res) => {
      try {
        const { status } = req.body;
        if (!["approved", "rejected", "suspended"].includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const seller = await sellersCollection.findOne({
          _id: new ObjectId(req.params.id),
        });

        await sellersCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { status } }
        );

        // Send email
        await transporter.sendMail({
          from: `"VendoSphere" <${process.env.MAIL_USER}>`,
          to: seller.email,
          subject: "Seller Application Update",
          html: `
        <h3>Hello ${seller.storeName}</h3>
        <p>Your seller request has been <b>${status.toUpperCase()}</b>.</p>
        <p>Thank you for being with VendoSphere.</p>
      `,
        });

        res.send({ success: true });
      } catch (error) {
        console.error("Update seller status error:", error);
        res.status(500).send({ message: "Failed to update seller status" });
      }
    });


    // Edit seller info 

    app.patch("/admin/sellers/:id", async (req, res) => {
      try {
        const { storeName, avatar, banner } = req.body;

        const result = await sellersCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          {
            $set: { storeName, avatar, banner },
          }
        );

        res.send({ success: true, result });
      } catch (error) {
        console.error("Edit seller error:", error);
        res.status(500).send({ message: "Failed to update seller" });
      }
    });


    // Delete Seller

    app.delete("/admin/sellers/:id", async (req, res) => {
      try {
        const sellerId = req.params.id;

        // delete seller
        const seller = await sellersCollection.findOne({
          _id: new ObjectId(sellerId),
        });

        await sellersCollection.deleteOne({
          _id: new ObjectId(sellerId),
        });

        // delete seller products
        await productsCollection.deleteMany({
          sellerEmail: seller.email,
        });

        res.send({ success: true });
      } catch (error) {
        console.error("Delete seller error:", error);
        res.status(500).send({ message: "Failed to delete seller" });
      }
    });



    // ================= ADMIN - MANAGE PRODUCTS =================

    app.get("/admin/products", async (req, res) => {
      try {
        const products = await productsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();

        // attach seller info
        const productsWithSeller = await Promise.all(
          products.map(async (product) => {
            const seller = await sellersCollection.findOne({
              email: product.sellerEmail,
            });

            return {
              ...product,
              sellerName: seller?.shopName || "Unknown",
              sellerId: seller?._id || null,
            };
          })
        );

        res.send(productsWithSeller);
      } catch (error) {
        console.error("Admin products error:", error);
        res.status(500).send({ message: "Failed to load products" });
      }
    });

    // approve / inactive / removed product

    app.patch("/admin/products/status/:id", async (req, res) => {
      try {
        const { status } = req.body;

        if (!["active", "inactive", "removed"].includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const result = await productsCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { status } }
        );

        res.send({ success: true, result });
      } catch (error) {
        console.error("Update product status error:", error);
        res.status(500).send({ message: "Failed to update status" });
      }
    });

    // edit product 

    app.patch("/admin/products/:id", async (req, res) => {
      try {
        const updateData = req.body;
        delete updateData._id;

        const result = await productsCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: updateData }
        );

        res.send({ success: true, result });
      } catch (error) {
        console.error("Admin edit product error:", error);
        res.status(500).send({ message: "Failed to update product" });
      }
    });


    // delete product

    app.delete("/admin/products/:id", async (req, res) => {
      try {
        await productsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });

        res.send({ success: true });
      } catch (error) {
        console.error("Admin delete product error:", error);
        res.status(500).send({ message: "Failed to delete product" });
      }
    });


    // ================= ADMIN - MANAGE Orders =================


    app.get("/admin/orders", async (req, res) => {
      try {
        const { status, seller, startDate, endDate } = req.query;

        let query = {};

        if (status) query.status = status;
        if (seller) query.sellerId = seller;

        if (startDate || endDate) {
          query.createdAt = {};
          if (startDate) query.createdAt.$gte = new Date(startDate);
          if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const orders = await ordersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.send(orders);
      } catch (error) {
        console.error("Admin orders error:", error);
        res.status(500).send({ message: "Failed to load orders" });
      }
    });

    // update order status

    app.patch("/admin/orders/status/:id", async (req, res) => {
      const { status } = req.body;

      if (!["pending", "shipped", "delivered", "cancelled"].includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }

      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status } }
      );

      res.send({ success: true, result });
    });

    // Bulk status update

    app.patch("/admin/orders/bulk-status", async (req, res) => {
      const { orderIds, status } = req.body;

      const result = await ordersCollection.updateMany(
        { _id: { $in: orderIds.map(id => new ObjectId(id)) } },
        { $set: { status } }
      );

      res.send({ success: true, result });
    });

    // cancel order

    app.patch("/admin/orders/cancel/:id", async (req, res) => {
      await ordersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: "cancelled" } }
      );

      res.send({ success: true });
    });


    // ================= ADMIN - MANAGE Payouts =================


    app.get("/admin/payouts", async (req, res) => {
      const payouts = await payoutsCollection
        .find({})
        .sort({ requestedAt: -1 })
        .toArray();

      res.send(payouts);
    });

    // update payout status

    app.patch("/admin/payouts/:id", async (req, res) => {
      const { status, adminNotes } = req.body;

      const result = await payoutsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        {
          $set: {
            status,
            adminNotes,
            updatedAt: new Date(),
          },
        }
      );

      // 📧 EMAIL NOTIFICATION (hook)
      // sendPayoutStatusEmail(sellerEmail, status, adminNotes);

      res.send({ success: true, result });
    });


    // pending payout total 

    app.get("/admin/payouts/summary", async (req, res) => {
      const pending = await payoutsCollection.aggregate([
        { $match: { status: "pending" } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]).toArray();

      res.send({
        pendingTotal: pending[0]?.total || 0,
      });
    });



    // ================= ADMIN - Analytics overview =================


    app.get("/admin/analytics/revenue", async (req, res) => {
      try {
        const orders = await ordersCollection
          .find({ status: "delivered" })
          .toArray();

        const revenueMap = {};

        orders.forEach(order => {
          const date = new Date(order.createdAt);
          const key = date.toLocaleString("default", {
            month: "short",
            year: "numeric",
          });

          revenueMap[key] = (revenueMap[key] || 0) + order.totalAmount;
        });

        const result = Object.entries(revenueMap).map(([month, revenue]) => ({
          month,
          revenue,
        }));

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Revenue analytics failed" });
      }
    });

    // order by status

    app.get("/admin/analytics/orders-status", async (req, res) => {
      const statuses = ["pending", "processing", "shipped", "delivered", "cancelled"];

      const data = await Promise.all(
        statuses.map(async (status) => ({
          name: status,
          value: await ordersCollection.countDocuments({ status }),
        }))
      );

      res.send(data);
    });

    // top seller by revenue

    app.get("/admin/analytics/top-sellers", async (req, res) => {
      const orders = await ordersCollection.find({ status: "delivered" }).toArray();

      const sellerRevenue = {};

      orders.forEach(order => {
        order.products.forEach(p => {
          sellerRevenue[p.sellerEmail] =
            (sellerRevenue[p.sellerEmail] || 0) + p.price * p.quantity;
        });
      });

      const result = Object.entries(sellerRevenue)
        .map(([seller, revenue]) => ({ seller, revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      res.send(result);
    });

    // top selling products

    app.get("/admin/analytics/top-products", async (req, res) => {
      const products = await productsCollection
        .find()
        .sort({ sold: -1 })
        .limit(5)
        .toArray();

      res.send(
        products.map(p => ({
          name: p.productName,
          sold: p.sold || 0,
        }))
      );
    });

    // New user signup per months

    app.get("/admin/analytics/users-growth", async (req, res) => {
      const users = await usersCollection.find().toArray();

      const map = {};

      users.forEach(u => {
        const date = new Date(u.createdAt);
        const key = date.toLocaleString("default", {
          month: "short",
          year: "numeric",
        });

        map[key] = (map[key] || 0) + 1;
      });

      const result = Object.entries(map).map(([month, users]) => ({
        month,
        users,
      }));

      res.send(result);
    });

    /* ===== ORDER creation checkout ===== */


    app.post("/orders", async (req, res) => {
      try {
        const {
          userEmail,
          items,
          shipping,
          paymentMethod,
          shippingCost,
          subtotal,
          total,
          note = "",
        } = req.body;

        /* ================= VALIDATION ================= */
        if (!userEmail || !items?.length) {
          return res.status(400).send({ message: "Invalid order data" });
        }

        /* ================= STOCK CHECK ================= */
        for (const item of items) {
          const product = await productsCollection.findOne({
            _id: new ObjectId(item.productId),
          });

          if (!product) {
            return res.status(404).send({
              message: `Product not found: ${item.name}`,
            });
          }

          if (product.stock < item.quantity) {
            return res.status(400).send({
              message: `Insufficient stock for ${item.name}`,
            });
          }
        }

        /* ================= DELIVERY ESTIMATION ================= */
        const estimatedDeliveryDays =
          shipping.city === "Dhaka" ? 3 : 5;

        /* ================= CREATE ORDER ================= */
        const order = {
          userEmail,

          products: items.map((item) => ({
            productId: item._id,
            name: item.name,
            image: item.image || item.images?.[0],
            price: item.price,
            quantity: item.quantity,
          })),

          shipping: {
            name: shipping.name,
            phone: shipping.phone,
            address: shipping.address,
            city: shipping.city,
            country: shipping.country || "Bangladesh",
          },

          paymentMethod,
          note,

          subtotal,
          shippingCost,
          discount: 0,
          totalAmount: total,

          status: paymentMethod === "cod" ? "pending" : "paid",
          estimatedDeliveryDays,

          createdAt: new Date(),
        };

        const result = await ordersCollection.insertOne(order);

        /* ================= REDUCE STOCK ================= */
        for (const item of items) {
          await productsCollection.updateOne(
            { _id: new ObjectId(item.productId) },
            { $inc: { stock: -item.quantity } }
          );
        }

        res.send({
          success: true,
          orderId: result.insertedId,
        });
      } catch (error) {
        console.error("Order creation failed:", error);
        res.status(500).send({
          message: "Failed to place order",
        });
      }
    });


    app.get("/orders/:orderId", async (req, res) => {
      try {
        const { orderId } = req.params;

        if (!ObjectId.isValid(orderId)) {
          return res.status(400).send({
            message: "Invalid order ID format",
          });
        }

        const order = await ordersCollection.findOne({
          _id: new ObjectId(orderId),
        });

        if (!order) {
          return res.status(404).send({ message: "Order not found" });
        }

        res.send(order);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });


    // payments related api

    app.get('/payments', verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.query.email;
        // console.log('decocded', req.decoded)
        if (req.decoded.email !== userEmail) {
          return res.status(403).send({ message: 'forbidden access' })
        }

        const query = userEmail ? { email: userEmail } : {};
        const options = { sort: { paid_at: -1 } }; // Latest first

        const payments = await paymentsCollection.find(query, options).toArray();
        res.send(payments);
      } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).send({ message: 'Failed to get payments' });
      }
    });


    app.post('/payments', async (req, res) => {
      try {
        const { orderId, email, amount, paymentMethod, transactionId } = req.body;

        // 1. Update order's payment_status
        const updateResult = await ordersCollection.updateOne(
          { _id: new ObjectId(orderId) },
          {
            $set: {
              status: 'paid'
            }
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res.status(404).send({ message: 'Parcel not found or already paid' });
        }

        // 2. Insert payment record
        const paymentDoc = {
          orderId,
          email,
          amount,
          paymentMethod,
          transactionId,
          paid_at_string: new Date().toISOString(),
          paid_at: new Date(),
        };

        const paymentResult = await paymentsCollection.insertOne(paymentDoc);

        res.status(201).send({
          message: 'Payment recorded and parcel marked as paid',
          insertedId: paymentResult.insertedId,
        });

      } catch (error) {
        console.error('Payment processing failed:', error);
        res.status(500).send({ message: 'Failed to record payment' });
      }
    });


    app.post('/create-payment-intent', async (req, res) => {
      const amountInCents = req.body.amountInCents
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents, // amount in cents
          currency: "usd",
          payment_method_types: ['card'],
        });
        res.json({ clientSecret: paymentIntent.client_secret })
      } catch (error) {
        res.status(500).json({ error: error.message })
      }
    })











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
