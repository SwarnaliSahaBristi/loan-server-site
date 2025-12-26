require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://b12-m11-session.web.app",
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("loansDb");

    const usersCollection = db.collection("users");
    const loansCollection = db.collection("loans");
    const applicationsCollection = db.collection("loanApplications");

    //role middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ message: "Admin only actions!!", role: user?.role });
      }
      next();
    };

    const verifyManager = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "manager") {
        return res
          .status(403)
          .send({ message: "Manager only actions!!", role: user?.role });
      }
      next();
    };

    //save user data in database
    app.post("/users", async (req, res) => {
      const userData = req.body;
      const query = { email: userData.email };

      const alreadyExists = await usersCollection.findOne(query);

      if (alreadyExists) {
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        });
        return res.send(result);
      }
      const newUser = {
        ...userData,
        role: userData.role || "borrower",
        status: "active",
        created_at: new Date().toISOString(),
        last_loggedIn: new Date().toISOString(),
      };

      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    // Get loans for Home Page (Limit 6 and filtered by showOnHome)
    app.get("/loans/home", async (req, res) => {
      const query = { showOnHome: true };
      const result = await loansCollection.find(query).limit(6).toArray();
      res.send(result);
    });

    app.get("/all-loans", async (req, res) => {
      const { page, limit, search, category } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      let query = { showOnHome: true };
      if (search) {
        query.loanTitle = { $regex: search, $options: "i" };
      }
      if (category) {
        query.category = category;
      }

      const loans = await loansCollection
        .find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      const total = await loansCollection.countDocuments(query);

      res.send({ loans, total });
    });

    app.get("/loan/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await loansCollection.findOne(query);
      res.send(result)
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
