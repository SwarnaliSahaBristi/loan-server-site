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
    origin: [process.env.CLIENT_DOMAIN],
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
        status: "approved",
        created_at: new Date().toISOString(),
        last_loggedIn: new Date().toISOString(),
      };

      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
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
      res.send(result);
    });

    // POST a new loan application
    app.post("/loan-applications", verifyJWT, async (req, res) => {
      const applicationData = req.body;
      const result = await applicationsCollection.insertOne(applicationData);
      res.send(result);
    });

    // Get loans for a specific borrower
    app.get("/my-loans", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const query = { userEmail: email };
      const result = await applicationsCollection.find(query).toArray();
      res.send(result);
    });

    //  Create Stripe Session
    app.post("/create-checkout-session", verifyJWT, async (req, res) => {
      const { loanId, loanName, loanImage, email } = req.body;
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: loanName,
                images: [loanImage],
                description: `Application fee for ${loanName}`,
              },
              unit_amount: 1000,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: { loanId, email },
        success_url: `${process.env.CLIENT_DOMAIN}/dashboard/my-loans?session_id={CHECKOUT_SESSION_ID}&loanId=${loanId}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard/my-loans`,
      });
      res.send({ url: session.url });
    });

    //Verify Payment after popup closes
    app.post(
      "/loan-applications/verify-payment",
      verifyJWT,
      async (req, res) => {
        const { loanId, sessionId, email } = req.body;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === "paid") {
          const filter = { _id: new ObjectId(loanId) };
          const updateDoc = {
            $set: {
              applicationFeeStatus: "paid",
              paymentInfo: {
                email: email,
                transactionId: session.payment_intent,
                paidAt: new Date(),
              },
            },
          };
          const result = await applicationsCollection.updateOne(
            filter,
            updateDoc
          );
          return res.status(200).send({ success: true, result });
        }
        res.status(400).send({ message: "Payment not completed" });
      }
    );

    app.get("/loan-application/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const result = await applicationsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.patch("/loan-applications/cancel/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const application = await applicationsCollection.findOne(filter);
      if (!application || application.status !== "pending") {
        return res.status(400).send({ message: "Cannot cancel this loan." });
      }
      const result = await applicationsCollection.deleteOne(filter);
      res.send(result);
    });

    // POST a new loan offering (Manager Only)
    app.post("/loans", verifyJWT, verifyManager, async (req, res) => {
      const loanData = req.body;
      const result = await loansCollection.insertOne(loanData);
      res.send(result);
    });

    //  Get all loans (Manager specific)
    app.get("/loans", verifyJWT, verifyManager, async (req, res) => {
      const result = await loansCollection.find().toArray();
      res.send({ loans: result });
    });

    //  Delete a loan
    app.delete("/loans/:id", verifyJWT, verifyManager, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await loansCollection.deleteOne(query);
      res.send(result);
    });

    app.patch("/loans/:id", verifyJWT, verifyManager, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: { ...req.body },
      };
      const result = await loansCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // Get loan applications by status (for Managers)
    app.get(
      "/manager/loan-applications",
      verifyJWT,
      verifyManager,
      async (req, res) => {
        const status = req.query.status;
        let query = {};
        if (status) {
          query.status = status;
        }
        const result = await applicationsCollection.find(query).toArray();
        res.send(result);
      }
    );

    // Approve a loan application
    app.patch(
      "/loan-applications/manager/:id/approve",
      verifyJWT,
      verifyManager,
      async (req, res) => {
        try {
          const id = req.params.id;
          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid ID format" });
          }

          const filter = { _id: new ObjectId(id) };
          const updateDoc = {
            $set: { status: "approved" },
          };
          const result = await applicationsCollection.updateOne(
            filter,
            updateDoc
          );

          if (result.modifiedCount > 0) {
            res.send(result);
          } else {
            res.status(404).send({ message: "Application not found" });
          }
        } catch (error) {
          console.error("Approve Error:", error);
          res
            .status(500)
            .send({ message: "Internal Server Error", error: error.message });
        }
      }
    );

    // Reject a loan application with a reason
    app.patch(
      "/loan-applications/manager/:id/reject",
      verifyJWT,
      verifyManager,
      async (req, res) => {
        const id = req.params.id;
        const { reason } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: "rejected",
            rejectionReason: reason,
            rejectedAt: new Date(),
            managedBy: req.user.email,
          },
        };
        const result = await applicationsCollection.updateOne(
          filter,
          updateDoc
        );
        res.send(result);
      }
    );

    // Get approve loan applications
    app.get(
      "/manager/loan-applications",
      verifyJWT,
      verifyManager,
      async (req, res) => {
        const status = req.query.status;
        let query = {};

        if (status) {
          query.status = status;
        }
        const result = await applicationsCollection
          .find(query)
          .sort({ approvedAt: -1, appliedAt: -1 })
          .toArray();

        res.send(result);
      }
    );

    app.patch(
      "/loan-applications/manager/:id/approve",
      verifyJWT,
      verifyManager,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };

        const updateDoc = {
          $set: {
            status: "approved",
            approvedAt: new Date(),
            handledBy: req.user.email,
          },
        };

        const result = await applicationsCollection.updateOne(
          filter,
          updateDoc
        );
        res.send(result);
      }
    );

    //get all loans for admin
    app.get("/admin/loans", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await loansCollection.find().toArray();
      res.send(result);
    });

    app.get("/admin/loans/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await loansCollection.findOne(query);
      if (!result) {
        return res.status(404).send({ message: "Loan not found" });
      }
      res.send(result);
    });

    app.patch(
      "/admin/loans/:id/show-on-home",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { showOnHome } = req.body;

          const filter = { _id: new ObjectId(id) };
          const updateDoc = {
            $set: { showOnHome: showOnHome },
          };

          const result = await loansCollection.updateOne(filter, updateDoc);
          res.send(result);
        } catch (error) {
          res.status(500).send({
            message: "Failed to toggle visibility",
            error: error.message,
          });
        }
      }
    );

    // Update a loan's details
    app.put("/admin/loans/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          loanTitle: updatedData.loanTitle,
          description: updatedData.description,
          category: updatedData.category,
          interestRate: parseFloat(updatedData.interestRate),
          maxLimit: parseFloat(updatedData.maxLimit),
          emiPlans: updatedData.emiPlans,
          showOnHome: updatedData.showOnHome,
          requiredDocuments: updatedData.requiredDocuments,
          loanImage: updatedData.loanImage,
          updatedAt: new Date(),
        },
      };

      const result = await loansCollection.updateOne(filter, updatedDoc);

      if (result.matchedCount === 0) {
        return res.status(404).send({ message: "Loan not found" });
      }

      res.send({
        success: true,
        message: "Loan updated successfully",
        result,
      });
    });

    app.delete("/admin/loans/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await loansCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/admin/users", verifyJWT, verifyAdmin, async (req, res) => {
      const { search, role, status, page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const adminEmail = req.tokenEmail;
      if (!adminEmail) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
      let query = {
        email: { $ne: adminEmail },
      };
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ];
      }
      if (role) {
        query.role = role;
      }
      if (status) {
        query.status = status;
      }
      const users = await usersCollection
        .find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();
      const total = await usersCollection.countDocuments(query);

      res.send({ users, total });
    });

    app.patch(
      "/admin/users/:id/role",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { role } = req.body;

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { role: role },
        };

        const result = await usersCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .send({ message: "User not found in database" });
        }

        res.send(result);
      }
    );

    app.patch(
      "/admin/users/:id/suspend",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { reason, feedback } = req.body;

        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: "suspended",
            suspendReason: reason,
            adminFeedback: feedback,
          },
        };

        const result = await usersCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.patch(
      "/admin/users/:id/approve",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: "approved",
          },
        };
        try {
          const result = await usersCollection.updateOne(filter, updatedDoc);
          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Failed to approve user" });
        }
      }
    );

    // Get users with filtering (Search, Role, Status)
    app.get(
      "/admin/users-management",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const { search, role, status } = req.query;
        const adminEmail = req.tokenEmail;
        if (!adminEmail) {
          return res.status(401).send({ message: "Unauthorized access" });
        }
        let query = {
          email: { $ne: adminEmail },
        };
        if (search) {
          query.$and = [
            { email: { $ne: adminEmail } },
            {
              $or: [
                { email: { $regex: search, $options: "i" } },
                { name: { $regex: search, $options: "i" } },
              ],
            },
          ];
        }
        if (role) query.role = role;
        if (status) query.status = status;
        const result = await usersCollection.find(query).toArray();
        res.send(result);
      }
    );

    // 1. Get all loan applications (with optional filtering)
    app.get(
      "/admin/loan-applications",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const result = await applicationsCollection
          .find()
          .sort({ appliedAt: -1 })
          .toArray();
        res.send(result);
      }
    );

    // 2. Update Loan Application Status
    app.patch(
      "/admin/loan-applications/:id/status",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status, reason } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: status,
            adminReason: reason || "",
            updatedAt: new Date(),
          },
        };

        const result = await applicationsCollection.updateOne(filter, updateDoc);

        if (result.modifiedCount > 0) {
          res.send({
            message: `Loan application ${status} successfully`,
            result,
          });
        } else {
          res.status(404).send({
            message: "Loan application not found or no changes made",
          });
        }
      }
    );

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
