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

    // users api

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
